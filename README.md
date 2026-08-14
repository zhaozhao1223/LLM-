# LLM-based Online Comments Summarizer

COMP5703 Capstone Project  
University of Sydney

## Project Information

- Project ID: CS6
- Group: CS6-1 
- Project Source: CMU Qatar
- Project Type: Browser Extension + Python Backend
- Main Function: Online comment capture, analysis, summarisation, and visualisation

---

## Project Overview

This project develops an LLM-based online comment summarisation system implemented as a browser extension with a Python backend service.

The system captures online comments from supported web pages, sends the collected comments to the backend, and generates structured analysis results using a multi-agent LLM-based architecture.

The system aims to help users quickly understand large comment sections by providing:

- Comment content summaries
- Engagement and interaction analysis
- Structural analysis of comment threads
- Temporal and quality-related insights
- Visual analysis results

---

## Repository Structure

```text
Group10-CS6/
│
├── comment-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── injected.js
│   ├── visual.html
│   ├── visual.js
│   └── echarts.min.js
│
├── comment-python/
│   ├── run.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── agents/
│   │   ├── db/
│   │   ├── engine/
│   │   ├── models/
│   │   └── services/
│   └── analyses.db  # generated after first run, not included
│
└── README.md
```

---

## Main Components

### 1. Browser Extension Frontend

The `comment-extension` folder contains the Chrome/Edge browser extension.

Main responsibilities:

- Capture comments from supported web pages
- Store captured comments temporarily in browser storage
- Send comment data to the backend service
- Display analysis results to the user
- Provide visual result pages using ECharts

### 2. Python Backend Service

The `comment-python` folder contains the FastAPI backend service.

Main responsibilities:

- Receive comment data from the browser extension
- Preprocess and enhance comment data
- Run multi-agent LLM analysis
- Generate structured summaries and insights
- Store analysis history in a local SQLite database
- Return analysis results to the frontend

---

## Tech Stack

- JavaScript
- Python 3.10
- FastAPI
- Uvicorn
- SQLite
- OpenAI-compatible LLM API
- Chrome Extension APIs
- ECharts

---

## Backend Setup Guide

### 1. Open the Backend Folder

```bash
cd comment-python
```

### 2. Create and Activate Python Environment

Python 3.10 is recommended.

```bash
conda create -n comment python=3.10 -y
conda activate comment
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables
 `.env` file inside the `comment-python` folder.
Create a local `.env` file inside the `comment-python` folder based on `.env.example`:

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=replace_with_your_api_key
OPENAI_MODEL=gpt-5
OPENAI_TIMEOUT=600
```

Do not hard-code API keys or passwords directly in the source code.

The `.env` file is used for local configuration and should not be uploaded to public repositories.

### 5. Start the Backend Service

```bash
python run.py
```

If the backend starts successfully, it should run at:

```text
http://127.0.0.1:8000
```

or:

```text
http://localhost:8000
```

---

## Browser Extension Setup Guide

### 1. Open Browser Extension Page

For Google Chrome:

```text
chrome://extensions/
```

For Microsoft Edge:

```text
edge://extensions/
```

### 2. Enable Developer Mode

Turn on **Developer mode** in the extensions page.

### 3. Load the Extension

Click **Load unpacked** and select the `comment-extension` folder.

After loading, the extension should appear in the browser extension list.

### 4. Use the Extension

1. Start the Python backend service.
2. Open a supported web page that contains comments.
3. Use the extension to capture comments.
4. Click **Analyze**.
5. Wait for the backend to return the analysis result.
6. View the summary and visual analysis results.

---

## Basic Running Workflow

```text
1. Start backend:
   cd comment-python
   conda activate comment
   python run.py

2. Load frontend:
   Open Chrome or Edge extensions page
   Enable Developer Mode
   Load the comment-extension folder

3. Use system:
   Open a supported comment page
   Capture comments
   Click Analyze
   View analysis result
```

---

## Backend API

### POST `/analyze/`

Receives captured comments and returns analysis results.

Request body example:

```json
{
  "comments": [
    {
      "id": "1",
      "text": "This is a sample comment.",
      "author": "user1",
      "created_at": "",
      "like_count": 10,
      "parent_id": ""
    }
  ]
}
```

### GET `/analyze/history`

Returns previous analysis history records.

### GET `/analyze/{analysis_id}`

Returns the detail of a specific analysis result.

---

## Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_BASE_URL` | Base URL of the OpenAI-compatible API service |
| `OPENAI_API_KEY` | API key used by the backend service |
| `OPENAI_MODEL` | Model name used for LLM analysis |
| `OPENAI_TIMEOUT` | Timeout setting for API requests |

---

## Important Notes

- The backend must be running before using the browser extension.
- The default backend address is `http://127.0.0.1:8000`.
- The browser extension depends on supported website structures and APIs.
- Some websites may change their page structure, which may affect comment capture.
- Large comment sets may take longer to process because the backend performs multi-step analysis.
- API credentials must be configured through the `.env` file.
- Real API keys should not be included in the source code or public repository.

---

## Troubleshooting

### Backend Does Not Start

Check whether the correct environment is activated:

```bash
conda activate comment
```

Check Python version:

```bash
python --version
```

Python 3.10 is recommended.

Reinstall dependencies:

```bash
pip install -r requirements.txt
```

### API Key Error

Check whether the `.env` file exists inside the `comment-python` folder.

Make sure `OPENAI_API_KEY` is correctly configured.

### Extension Cannot Connect to Backend

Make sure the backend is running at:

```text
http://127.0.0.1:8000
```

Also check whether the backend URL in the extension code matches the running backend address.

### No Comments Are Captured

Refresh the target page and try again.

If comments are still not captured, try another supported page or check the browser console for extension errors.

### Visual Result Page Shows No Data

Run the analysis again from the original page before opening the visual result page.

The visual result page depends on the latest analysis data stored by the extension.

---

## Known Limitations

- The backend currently runs as a local FastAPI service.
- The browser extension currently supports selected online platforms and page structures.
- Website structure changes may affect comment capture.
- Large comment sets may increase processing time.
- The system requires an external LLM API key before running.
- The current version is a prototype and may require further optimisation for production deployment.

---

## Security Notice

The project must not include real API keys, passwords, or private credentials in the source code.

Use `.env` for local configuration.

Before final handover, check that no hard-coded credentials remain in the repository.

---

## Team Members

- Mingjie Shan, 490457269, msha0970@uni.sydney.edu.au
- Haoyang Zheng, 550126193, hzhe0827@uni.sydney.edu.au
- Qi Chen, 550010205, qche0473@uni.sydney.edu.au
- Bing Yao, 540367984, byao0918@uni.sydney.edu.au
- Zhihao Han, 550108292, zhan0430@uni.sydney.edu.au
- Bingyan Tang, 530673176, btan0872@uni.sydney.edu.au
- Zijian Huang, 541004554, zhua0961@uni.sydney.edu.au
- Xiaoyan Gao, 540337518, xgao0105@uni.sydney.edu.au

