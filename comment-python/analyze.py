from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Analysis, AgentOutput
from app.models.request import AnalyzeRequest
from app.services.analysis_service import analyze_comments
import json

router = APIRouter(prefix="/analyze", tags=["analysis"])


@router.post("/")
async def analyze(request: AnalyzeRequest):
    return await analyze_comments(request.comments)


@router.get("/history")
async def get_history(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Number of records per page"),
):
    count_stmt = select(func.count()).select_from(Analysis)
    total = (await db.execute(count_stmt)).scalar() or 0

    stmt = (
        select(Analysis)
        .order_by(Analysis.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "comment_count": r.comment_count,
                "user_count": r.user_count,
                "hot_ratio": r.hot_ratio,
                "structure_rule": r.structure_rule,
                "engagement_rule": r.engagement_rule,
                "status": r.status,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": ceil(total / page_size) if total > 0 else 0,
    }


@router.get("/{analysis_id}")
async def get_analysis(analysis_id: int, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    stmt = select(AgentOutput).where(AgentOutput.analysis_id == analysis_id)
    outputs = await db.execute(stmt)
    agents = {o.agent_name: o.output for o in outputs.scalars().all()}

    return {
        "id": analysis.id,
        "created_at": analysis.created_at.isoformat(),
        "features": json.loads(analysis.features_json) if analysis.features_json else None,
        "comments": json.loads(analysis.comments_json) if analysis.comments_json else None,
        "rules": {
            "structure": analysis.structure_rule,
            "engagement": analysis.engagement_rule,
        },
        "analysis": agents,
        "meta": analysis.meta_output,
    }