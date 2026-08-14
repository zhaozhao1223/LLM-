from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    request_hash = Column(String(64), index=True, default="")
    comment_count = Column(Integer, default=0)
    user_count = Column(Integer, default=0)
    hot_ratio = Column(Float, default=0)
    structure_rule = Column(String(20))
    engagement_rule = Column(String(20))
    features_json = Column(Text)
    comments_json = Column(Text)
    meta_output = Column(Text)
    status = Column(String(20), default="completed")

    agent_outputs = relationship("AgentOutput", back_populates="analysis", cascade="all, delete-orphan")


class AgentOutput(Base):
    __tablename__ = "agent_outputs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    analysis_id = Column(Integer, ForeignKey("analyses.id"), nullable=False)
    agent_name = Column(String(20), nullable=False)
    output = Column(Text)

    analysis = relationship("Analysis", back_populates="agent_outputs")
