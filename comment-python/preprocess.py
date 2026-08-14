from collections import defaultdict
from datetime import datetime, timezone
import math
import statistics
import re


def clean_text(text):
    """Clean comment text by removing mentions, URLs, emojis, and extra spaces."""
    if not text:
        return ""

    text = re.sub(r'@\S+', '', text)
    text = re.sub(r'https?://\S+', '', text)
    text = re.sub(r'www\.\S+', '', text)

    emoji_pattern = re.compile('['
                               u'\U0001F600-\U0001F64F'
                               u'\U0001F300-\U0001F5FF'
                               u'\U0001F680-\U0001F6FF'
                               u'\U00002702-\U000027B0'
                               ']+', flags=re.UNICODE)
    text = emoji_pattern.sub('', text)

    text = ' '.join(text.split())
    return text


def parse_vote_score(value):
    """Convert vote score into an integer while preserving negative Reddit scores."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def split_vote_score(value):
    """
    Split raw vote score into positive and negative components.

    Reddit score can be negative because it represents net votes.
    We preserve the raw score, use the positive part for log-based hot score,
    and use the negative part as a downvote/controversy signal.
    """
    raw = parse_vote_score(value)
    positive = max(raw, 0)
    negative = abs(min(raw, 0))
    return raw, positive, negative


def parse_comment_time(created_at, now):
    """Parse comment time and return hours since creation."""
    if not created_at:
        return 0

    try:
        dt = datetime.strptime(created_at, "%a %b %d %H:%M:%S %z %Y")
        diff = now - dt.astimezone(timezone.utc)
        return max(0, diff.total_seconds() / 3600)
    except Exception:
        return 0


def enhance_comments(comments):
    """Enhance raw comments with depth, children count, time weight, and hot score."""

    if not comments:
        return []

    id_map = {c.id: c for c in comments if c.id}
    children_map = defaultdict(list)

    for c in comments:
        c.text = clean_text(c.text)
        raw_like, positive_like, negative_like = split_vote_score(c.like_count)

        c.raw_like_count = raw_like
        c.like_count = positive_like
        c.positive_like_count = positive_like
        c.negative_like_count = negative_like

        if c.parent_id and c.parent_id in id_map:
            children_map[c.parent_id].append(c.id)

    now = datetime.now(timezone.utc)

    # First pass: calculate depth, root id, children count, text length, and time weight.
    for c in comments:
        current = c
        depth = 1
        visited = set()

        while (
            current.parent_id
            and current.parent_id in id_map
            and current.parent_id not in visited
        ):
            visited.add(current.parent_id)
            depth += 1
            current = id_map[current.parent_id]

        c.real_depth = depth
        c.root_id = current.id or c.id or ""
        c.children_count = len(children_map.get(c.id, []))
        c.text_length = len(c.text or "")

        hours_since = parse_comment_time(c.created_at, now)
        c.hours_since = round(hours_since, 2)
        c.time_weight = round(math.exp(-hours_since / 24), 4)

    max_like = max((c.positive_like_count or 0) for c in comments) or 1
    max_negative = max((c.negative_like_count or 0) for c in comments) or 1
    max_like_score = max((math.log1p(c.positive_like_count or 0) for c in comments), default=0) or 1
    
    max_children = max((c.children_count or 0) for c in comments) or 1
   
    # Second pass: calculate like ratio and hot score after all required values exist.
    for c in comments:
        positive_like = c.positive_like_count or 0
        negative_like = c.negative_like_count or 0

        c.like_ratio = round(positive_like / max_like, 4) if max_like > 0 else 0
        c.negative_like_ratio = round(negative_like / max_negative, 4) if max_negative > 0 else 0

        like_score = math.log1p(positive_like) / max_like_score
        reply_score = (c.children_count or 0) / max_children
        depth_score = 1 - math.exp(-(c.real_depth or 1) / 2)
        time_score = c.time_weight or 0
        negative_penalty = negative_like / max_negative

        c.hot_score = round(
            max(
                0,
                0.4 * like_score +
                0.25 * reply_score +
                0.2 * time_score +
                0.15 * depth_score -
                0.15 * negative_penalty
            ),
            4
        )

    scores = [c.hot_score or 0 for c in comments]

    if not scores:
        return comments

    mean_score = statistics.mean(scores)
    std_score = statistics.stdev(scores) if len(scores) > 1 else 0
    threshold = mean_score + 0.8 * std_score

    for c in comments:
        c.is_hot = (c.hot_score or 0) > threshold

    return comments


def extract_all_comments(comments):
    result = {}
    for i, c in enumerate(comments):
        if hasattr(c, "text"):
            result[i] = c.text
        elif isinstance(c, dict) and "text" in c:
            result[i] = c["text"]
    return result