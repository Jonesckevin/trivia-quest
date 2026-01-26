# Trivia Quest

![Example](./example.png)

## About

A trivia quiz web application.

## Getting Started

### Docker Build

To add new question categories or banks to the database, you only need to create/add a new JSONL to question_bank/ and run the build command. The files in the question bank are imported on docker build. 

If you need a template, just add any question from the WebApp and export it to get the format.

```bash
docker compose up -d --build
```

### Python Local Server

```bash
python -m http.server 8000
```
Then open your browser to http://localhost:8000/

Or 

```powershell
.\start_server.ps1
```
```bash
bash .\start_server.sh
```
Then open your browser to http://localhost:8080/

