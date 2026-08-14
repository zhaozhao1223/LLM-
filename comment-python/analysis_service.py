import asyncio
import hashlib
import json
from sqlalchemy import select
from app.db.database import async_session
from app.db.models import Analysis, AgentOutput
from app.engine.preprocess import enhance_comments, extract_all_comments
from app.engine.compress import compress_comments, cluster_comments
from app.engine.rules import run_rules
from app.engine.compress import pick_features_for_structural, pick_features_for_engagement, pick_features_for_temporal, \
    pick_features_for_quality
from app.agents.structural_agent import structural_agent
from app.agents.engagement_agent import engagement_agent
from app.agents.temporal_agent import temporal_agent
from app.agents.quality_agent import quality_agent
from app.agents.meta_agent import meta_agent
from app.agents.content_agent import content_agent
from app.agents.summary_agent import summary_agent


def _build_analysis_hash(comments):
    raw = json.dumps([c.model_dump() for c in comments], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


async def _cached_result(session, request_hash):
    """Find cached result. Return (result, True) if found, otherwise (None, False)."""
    stmt = (
        select(Analysis)
        .where(Analysis.request_hash == request_hash)
        .order_by(Analysis.id.desc())
        .limit(1)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if not row:
        return None, False

    # Load agent outputs.
    out_stmt = select(AgentOutput).where(AgentOutput.analysis_id == row.id)
    outputs = (await session.execute(out_stmt)).scalars().all()
    agents = {o.agent_name: o.output for o in outputs}

    result = {
        "features": json.loads(row.features_json) if row.features_json else {},
        "rules": {
            "structure": row.structure_rule,
            "engagement": row.engagement_rule,
        },
        "comments": json.loads(row.comments_json) if row.comments_json else {},
        "analysis": agents,
        "meta": row.meta_output,
    }
    return result, True


async def analyze_comments(comments):
    if not comments:
        return {
            "features": {},
            "rules": {},
            "comments": {},
            "analysis": {
                "summary": "No comments were provided for analysis.",
                "structural": "",
                "engagement": "",
                "temporal": "",
                "quality": "",
                "content": ""
            },
            "meta": "No analysis was performed because no comments were provided.",
            "cached": False
        }

    # Check cache hit.
    request_hash = _build_analysis_hash(comments)
    async with async_session() as session:
        cached, hit = await _cached_result(session, request_hash)
        if hit:
            print("cache hit")
            cached["cached"] = True
            return cached

    print("start analyzing")

    # Preprocess comments.
    enriched = enhance_comments(comments)
    # print("enriched data: \n", enriched)

    # Extract raw comments.
    all_comments = extract_all_comments(comments)
    # print("all comments: \n", all_comments)

    # Compress comment features.
    features = compress_comments(enriched)
    # print("features: \n", features)

    # Run rule-based analysis.
    rule_results = run_rules(features)
    # print("rule results: \n", rule_results)

    # Cluster comments.
    if len(all_comments) > 10:
        print("start clustering")
        content = cluster_comments(all_comments, "")
        print("content concerned: \n", content)
        a, b, c, d, e = await asyncio.gather(
            structural_agent.run(pick_features_for_structural(features), rule_results),
            engagement_agent.run(pick_features_for_engagement(features), rule_results),
            temporal_agent.run(pick_features_for_temporal(features), rule_results),
            quality_agent.run(pick_features_for_quality(features), rule_results),
            content_agent.run(content)
        )
    else:
        print("no clustering")
        a, b, c, d, e = await asyncio.gather(
            structural_agent.run(pick_features_for_structural(features), rule_results),
            engagement_agent.run(pick_features_for_engagement(features), rule_results),
            temporal_agent.run(pick_features_for_temporal(features), rule_results),
            quality_agent.run(pick_features_for_quality(features), rule_results),
            content_agent.run(all_comments)
        )

    # Generate meta analysis.
    meta = await meta_agent.run({
        "structural": a,
        "engagement": b,
        "temporal": c,
        "quality": d,
        "content": e
    },
        rule_results
    )

    user_summary = await summary_agent.run({
    "content_summary": e,
    "structural_analysis": a,
    "engagement_analysis": b,
    "temporal_analysis": c,
    "quality_analysis": d,
    "rule_results": rule_results,
    "overall_synthesis": meta,
    "key_features": {
        "global": features.get("global", {}),
        "depth": features.get("depth", {}),
        "branch": features.get("branch", {}),
        "like": features.get("like", {}),
        "time": features.get("time", {}),
        "text": features.get("text", {}),
        "thread": features.get("thread", {})
    }
    })

    result = {
        "features": features,
        "rules": rule_results,
        "comments": all_comments,
        "analysis": {
            "summary": user_summary,
            "structural": a,
            "engagement": b,
            "temporal": c,
            "quality": d,
            "content": e
        },
        "meta": meta
    }
    # Debug output is disabled for delivery version.
    # The analysis result is returned through the API and saved into SQLite.
    # with open('analysis_result.json', 'w', encoding='utf-8') as f:
    #     json.dump(result, f, ensure_ascii=False, indent=2)
    # with open('analysis_result.json', 'r', encoding='utf-8') as f:
    #     result = json.load(f)

    # Save analysis result into SQLite.
    try:
        async with async_session() as session:
            analysis = Analysis(
                request_hash=request_hash,
                comment_count=features.get("global", {}).get("n", 0),
                user_count=features.get("global", {}).get("users", 0),
                hot_ratio=features.get("global", {}).get("hot_ratio", 0),
                structure_rule=rule_results.get("structure"),
                engagement_rule=rule_results.get("engagement"),
                features_json=json.dumps(features, ensure_ascii=False),
                comments_json=json.dumps(all_comments, ensure_ascii=False),
                meta_output=meta,
                status="completed"
            )
            session.add(analysis)
            await session.flush()

            for name, output in [
                ("summary", user_summary),
                ("structural", a),
                ("engagement", b),
                ("temporal", c),
                ("quality", d),
                ("content", e)
            ]:
                session.add(AgentOutput(
                    analysis_id=analysis.id,
                    agent_name=name,
                    output=output
                ))
            await session.commit()
    except Exception as ex:
        print(f"DB save failed: {ex}")

    result["cached"] = False
    return result
