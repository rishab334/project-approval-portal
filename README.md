# ProjectFlow – Project Management & Approval System

## Overview

ProjectFlow is a web-based project management and approval system that allows employees to create and configure projects, submit them for approval, and track their status. Managers can review submitted projects and approve or reject them.

## Features

- Project creation and management.
- Client information management.
- Contract document uploads.
- Job categories and rate card mapping.
- Project validation and error handling.
- Employee and manager roles.
- Project submission and approval workflow.
- Project rejection with mandatory comments.
- Editing and resubmission of rejected projects.
- Project versioning and re-approval workflow.
- Audit trail for project activities.

## Technology Stack

### Frontend
- React.js
- Vite
- JavaScript
- CSS

### Backend
- Python
- FastAPI
- REST APIs
- SQLAlchemy

### Database
- PostgreSQL

### Development Tools
- Visual Studio Code
- Git
- GitHub

## Project Structure

```text
project-approval-portal/
│
├── backend/
│   ├── main.py
│   ├── .env
│   ├── uploads/
│   └── venv/
│
├── src/
│   ├── App.jsx
│   ├── App.css
│   ├── login.jsx
│   └── login.css
│
├── public/
├── ProjectFlow_README.pdf
├── package.json
├── package-lock.json
├── vite.config.js
├── .gitignore
└── README.md
```

## Installation and Setup

### Prerequisites

- Python 3.10 or later
- Node.js and npm
- PostgreSQL

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd project-approval-portal
```

### 2. Start the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-multipart python-dotenv
```

Configure the database connection in the backend `.env` file.

Example:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/projectflow
```

Start the backend:

```bash
uvicorn main:app --reload
```

Backend URL:

http://127.0.0.1:8000

API documentation:

http://127.0.0.1:8000/docs

### 3. Start the frontend

Open another terminal from the project root:

```bash
npm install
npm run dev
```

Frontend URL:

http://localhost:5173

## Application Workflow

1. Employee logs into the application.
2. Employee creates a project and enters the required details.
3. Employee adds client information and contract documents.
4. Employee selects job categories and mapped rate cards.
5. Employee submits the project for approval.
6. Manager reviews the submitted project.
7. Manager approves or rejects the project.
8. Rejected projects can be edited and resubmitted.
9. Approved project updates follow a new version and approval workflow.

## API Documentation

FastAPI interactive documentation:

http://127.0.0.1:8000/docs

The API supports project management, client management, contract management, submission, approval, rejection, and audit-related operations.

## AWS Deployment Architecture

The planned AWS deployment architecture includes:

- Amazon API Gateway – API access.
- AWS Lambda – Backend execution.
- Amazon RDS PostgreSQL – Database.
- Amazon S3 – Contract document storage.
- Amazon Cognito or role-based authentication – Access management.

**Deployment status:** AWS deployment is pending.

## Security Notes

- Keep database credentials in environment variables.
- Do not upload `.env` files or passwords to GitHub.
- Do not commit virtual environments or uploaded private documents.
- Use appropriate access controls for employee and manager roles.

## Documentation

For additional project documentation, refer to `ProjectFlow_README.pdf` included in the repository.

## Author

Rishab R

Project: ProjectFlow – Project Management & Approval System.      