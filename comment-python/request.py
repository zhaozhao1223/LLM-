from pydantic import BaseModel
from typing import List, Optional

class CommentItem(BaseModel):

    text: str
    author: Optional[str] = "Anonymous"
    created_at: Optional[str] = ""
    like_count: Optional[int] = 0
    parent_id: Optional[str] = ""
    reply_depth: Optional[int] = 0
    user_id: Optional[str] = ""
    id: Optional[str] = ""
    hours_since: Optional[float] = 0

    real_depth: Optional[int] = 0
    # text_valid: str
    root_id: Optional[str] = ""
    children_count: Optional[int] = 0
    text_length: Optional[int] = 0
    like_ratio: Optional[float] = 0
    time_weight: Optional[float] = 0
    is_hot: Optional[bool] = False
    hot_score: Optional[float] = 0
    raw_like_count: Optional[int] = 0
    positive_like_count: Optional[int] = 0
    negative_like_count: Optional[int] = 0
    negative_like_ratio: Optional[float] = 0

class AnalyzeRequest(BaseModel):
    comments: List[CommentItem]