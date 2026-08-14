from app.agents.base_agent import BaseAgent

system_prompt = """
You are evaluating interaction quality.

Using:
- mean_text_length
- length histogram
- deep_ratio
- branching distribution

Tasks:
1. Estimate discussion depth quality.
2. Identify conversational intensity.
3. Assess deliberation potential.
4. Provide metric-based reasoning.
5. Output structured JSON.              
"""

quality_agent = BaseAgent(system_prompt)