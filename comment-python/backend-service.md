# Backend Service Workflow

This document describes the overall workflow of the backend service for the online comment analysis system.

The backend is built with **FastAPI** and a **multi-agent LLM analysis architecture**. It receives comment data from the browser extension, preprocesses the comments, extracts statistical features, performs multi-dimensional analysis through several LLM agents, and finally returns a complete analysis result to the frontend.

---

# 1. Overall Workflow

```mermaid
flowchart TD
A[Client submits comment data] --> B[/analyze endpoint]
B --> C[Comment preprocessing]
C --> D[Extract raw comment texts]
C --> E[Comment feature compression]

E --> F1[Structural Analysis Agent]
E --> F2[Engagement Analysis Agent]
E --> F3[Temporal Dynamics Agent]
E --> F4[Participation Ecology Agent]
E --> F5[Interaction Quality Agent]

F1 --> G[Meta Analysis Agent]
F2 --> G
F3 --> G
F4 --> G
F5 --> G

G --> H[Return analysis result]
```

---

# 2. Service Startup

The backend uses **FastAPI** to start an HTTP service.

The main startup tasks include:

- Creating the `FastAPI` application
- Configuring CORS access
- Initialising the logging system
- Defining request and response data models
- Registering API routers

The backend service can be started by running:

```bash
python run.py
```

The service is started through Uvicorn with a configuration similar to:

```python
uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
```

After startup, the backend provides the following main endpoints:

```text
GET  /
POST /analyze/
GET  /analyze/history
GET  /analyze/{analysis_id}
```

---

# 3. Client Request Stage

The client submits captured comment data through the `POST /analyze/` endpoint.

The request process is:

1. The browser extension captures comments from a supported web page.
2. The extension sends the comment list to the backend `/analyze/` endpoint.
3. FastAPI receives and validates the request data.
4. The backend calls the main analysis service function.
5. The comment data enters the preprocessing and analysis pipeline.

The input data is mainly a list of comment objects. Each comment may contain fields such as:

```text
id
text
author
created_at
like_count
parent_id
reply_depth
user_id
```

---

# 4. Comment Preprocessing Stage

Before the formal LLM analysis starts, the backend first performs structured preprocessing on the raw comments.

The main preprocessing tasks include:

1. Cleaning comment text
2. Building parent-child relationships between comments
3. Calculating the real depth of each comment
4. Counting the number of child comments
5. Calculating comment text length
6. Calculating time decay weight
7. Processing positive and negative vote scores
8. Calculating comment hot score
9. Marking hot comments

The purpose of this stage is to transform raw comment data into comment objects with additional structural and behavioural features.

```text
Raw comment data
        ↓
Enhanced comment objects with structural and interaction features
```

This stage also improves system stability by handling special cases such as empty comments, missing timestamps, and negative Reddit scores.

---

# 5. Comment Feature Compression Stage

After preprocessing, the enhanced comments are compressed into a statistical feature structure.

The purpose of feature compression is to:

- Reduce the size of the input data
- Extract global patterns from the comment section
- Reduce LLM token usage
- Provide structured inputs for different analysis agents
- Improve the consistency of agent outputs

The output of this stage can be described as:

```text
Comment list
        ↓
Statistical summary of the comment section
```

The compressed feature structure includes information such as:

- Total number of comments
- Number of unique users
- Comment depth distribution
- Reply structure
- Engagement distribution
- Time-related features
- Text length distribution
- Hot comment ratio
- Interaction patterns

---

# 6. Multi-Agent Parallel Analysis

The backend uses a **multi-agent parallel analysis architecture**.

Multiple LLM-based agents are called through asynchronous execution. Each agent receives the same compressed statistical feature input but focuses on a different analytical dimension.

The parallel analysis modules include:

| Agent            | Responsibility                                          |
|------------------|---------------------------------------------------------|
| Structural Agent | Analyses the structure and shape of the comment section |
| Engagement Agent | Analyses likes, replies, and interaction distribution   |
| Temporal Agent   | Analyses time-related activity patterns                 |
| Ecology Agent    | Analyses user participation and discussion ecology      |
| Quality Agent    | Analyses discussion quality and interaction quality     |

These agents are executed in parallel to improve efficiency and to separate the analysis into clear dimensions.

All agents share the same statistical feature input but produce different analytical interpretations.

---

# 7. Meta Analysis Stage

After the individual agents complete their analysis, the backend calls the **Meta Analysis Agent**.

The Meta Agent is responsible for integrating the outputs from all other agents and producing a unified interpretation of the comment section.

The main tasks of the Meta Agent include:

1. Summarising the outputs from different agents
2. Combining structural, engagement, temporal, ecological, and quality insights
3. Inferring overall discussion patterns
4. Producing a final integrated explanation
5. Returning a coherent analysis result for frontend display

The input to the Meta Agent is similar to:

```json
{
  "structural": "...",
  "engagement": "...",
  "temporal": "...",
  "ecology": "...",
  "quality": "..."
}
```

The output is an overall analytical conclusion about the comment section.

---

# 8. Result Return Stage

The backend finally returns a complete analysis result to the frontend.

The returned result may include:

| Field          | Description                           |
|----------------|---------------------------------------|
| `raw_comments` | Extracted raw comment texts           |
| `features`     | Compressed statistical features       |
| `structural`   | Structural analysis result            |
| `engagement`   | Engagement analysis result            |
| `temporal`     | Temporal dynamics analysis result     |
| `ecology`      | Participation ecology analysis result |
| `quality`      | Interaction quality analysis result   |
| `meta`         | Integrated meta-analysis conclusion   |
| `summary`      | User-facing summary result            |

The frontend can display different parts of the result depending on the user interface design.

For example:

- The main popup can display the summary and key findings.
- The visual result page can display charts based on the `features` data.
- Advanced users can inspect detailed agent outputs if needed.

---

# 9. Database and History Storage

The backend uses a local SQLite database to store analysis history.

The database is used to record:

- Basic information about each analysis request
- Comment count and user count
- Extracted statistical features
- Agent analysis outputs
- Analysis status
- Creation time

This allows the backend to support history-related endpoints such as:

```text
GET /analyze/history
GET /analyze/{analysis_id}
```

The SQLite database is suitable for local demonstration and prototype deployment. For production-scale deployment, the storage layer can be upgraded to a more scalable database if required.

---

# 10. Complete Execution Summary

The complete backend execution process can be summarised as:

```text
Client request
      ↓
FastAPI receives comment data
      ↓
Comment preprocessing
      ↓
Feature compression
      ↓
Multi-agent parallel analysis
      ↓
Meta-level integration
      ↓
Result storage
      ↓
Return analysis result to frontend
```

This pipeline implements the full process from raw online comments to structured analysis, multi-dimensional interpretation, and final user-facing summary.

