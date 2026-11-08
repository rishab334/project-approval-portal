import os
import re
from pathlib import Path
from uuid import uuid4
from datetime import date
from decimal import Decimal
from typing import Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from sqlalchemy import create_engine, text


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
CONTRACTS_DIR = BASE_DIR / "uploads" / "contracts"
MAX_CONTRACT_SIZE = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx"}


def load_local_env():
    """Small .env reader; avoids requiring python-dotenv."""
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is missing. Create backend/.env and set "
        "DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/project_workflow"
    )

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

app = FastAPI(title="ProjectFlow API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# DATABASE INITIALIZATION / SAFE ADDITIVE MIGRATIONS
# ---------------------------------------------------------

def initialize_database():
    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS clients (
                id SERIAL PRIMARY KEY,
                client_name VARCHAR(150) NOT NULL,
                legal_entity VARCHAR(200) NOT NULL,
                registered_address TEXT NOT NULL,
                billing_address TEXT NOT NULL,
                gst_number VARCHAR(15),
                payment_mode VARCHAR(50) NOT NULL,
                currency VARCHAR(3) NOT NULL DEFAULT 'INR',
                primary_contact_name VARCHAR(150) NOT NULL,
                primary_contact_email VARCHAR(150) NOT NULL,
                primary_contact_phone VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Safe additive migration: preserve existing client records.
        conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS primary_contact_designation VARCHAR(150) NOT NULL DEFAULT ''"))

        # The projects table is pre-existing and is deliberately not recreated.
        existing = conn.execute(text("""
            SELECT to_regclass('public.projects')
        """)).scalar()
        if not existing:
            raise RuntimeError(
                "The existing public.projects table was not found. "
                "Check DATABASE_URL; this API will not create or replace it."
            )

        project_columns = {
            "project_start_date": "DATE",
            "project_end_date": "DATE",
            "created_by": "VARCHAR(150)",
            "business_unit": "VARCHAR(100)",
            "assigned_reviewer": "VARCHAR(150)",
            "version_number": "INTEGER NOT NULL DEFAULT 1",
            "root_project_id": "INTEGER",
            "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
        }
        for column, sql_type in project_columns.items():
            conn.execute(text(
                f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {column} {sql_type}"
            ))

        conn.execute(text("""
            UPDATE projects
            SET root_project_id = id
            WHERE root_project_id IS NULL
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_contracts (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                original_filename VARCHAR(255) NOT NULL,
                stored_filename VARCHAR(255) NOT NULL,
                file_path TEXT NOT NULL,
                content_type VARCHAR(150),
                file_size BIGINT NOT NULL,
                document_type VARCHAR(80) NOT NULL,
                valid_from DATE,
                valid_to DATE,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_audit_logs (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                action VARCHAR(80) NOT NULL,
                performed_by VARCHAR(150) NOT NULL DEFAULT 'System',
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_job_categories (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                category_name VARCHAR(100) NOT NULL,
                rate_card_code VARCHAR(60) NOT NULL,
                rate_amount NUMERIC(12,2) NOT NULL CHECK (rate_amount > 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))


@app.on_event("startup")
def startup_event():
    initialize_database()


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class ProjectCreate(BaseModel):
    client_name: str = Field(min_length=1, max_length=150)
    project_name: str = Field(min_length=1, max_length=120)
    quoted_price: Decimal = Field(gt=0, le=999999999)
    job_category: str = Field(min_length=1, max_length=60)
    project_start_date: Optional[date] = None
    project_end_date: Optional[date] = None
    created_by: str = Field(default="Employee", max_length=150)
    business_unit: Optional[str] = Field(default=None, max_length=100)
    assigned_reviewer: Optional[str] = Field(default=None, max_length=150)


class ProjectDraftUpdate(BaseModel):
    client_name: str = Field(min_length=1, max_length=150)
    project_name: str = Field(min_length=1, max_length=120)
    quoted_price: Decimal = Field(gt=0, le=999999999)
    job_category: str = Field(min_length=1, max_length=60)
    project_start_date: Optional[date] = None
    project_end_date: Optional[date] = None
    created_by: str = Field(default="Employee", max_length=150)
    business_unit: Optional[str] = Field(default=None, max_length=100)
    assigned_reviewer: Optional[str] = Field(default=None, max_length=150)


class ManagerReview(BaseModel):
    status: str
    manager_comment: str = ""
    reviewed_by: str = Field(min_length=1, max_length=150)


class ClientCreate(BaseModel):
    client_name: str = Field(min_length=2, max_length=150)
    legal_entity: str = Field(min_length=2, max_length=200)
    registered_address: str = Field(min_length=5)
    billing_address: str = Field(default="", max_length=1000)
    gst_number: str = Field(min_length=15, max_length=15)
    payment_mode: str = Field(min_length=2, max_length=50)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    primary_contact_name: str = Field(min_length=2, max_length=150)
    primary_contact_designation: str = Field(default="", max_length=150)
    primary_contact_email: str = Field(min_length=5, max_length=150)
    primary_contact_phone: str = Field(min_length=7, max_length=20)


class JobCategoryInput(BaseModel):
    category_name: str = Field(min_length=1, max_length=100)
    rate_card_code: str = Field(min_length=1, max_length=60)
    rate_amount: Decimal = Field(gt=0, le=999999999)


class JobCategoriesUpdate(BaseModel):
    categories: List[JobCategoryInput] = Field(min_length=1)


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def log_action(conn, project_id: int, action: str, performed_by: str, details: str = ""):
    conn.execute(text("""
        INSERT INTO project_audit_logs (project_id, action, performed_by, details)
        VALUES (:project_id, :action, :performed_by, :details)
    """), {
        "project_id": project_id,
        "action": action,
        "performed_by": (performed_by or "System").strip()[:150],
        "details": details,
    })


def get_project_or_404(conn, project_id: int):
    project = conn.execute(
        text("SELECT * FROM projects WHERE id = :id"),
        {"id": project_id},
    ).mappings().first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def validate_project_dates(start_date, end_date):
    if start_date and end_date and end_date < start_date:
        raise HTTPException(
            status_code=400,
            detail="Project end date cannot be before project start date.",
        )


def project_values(project):
    validate_project_dates(project.project_start_date, project.project_end_date)
    client_name = project.client_name.strip()
    project_name = project.project_name.strip()
    category = project.job_category.strip()
    if not client_name or not project_name or not category:
        raise HTTPException(status_code=400, detail="Required project fields cannot be empty.")
    return {
        "client_name": client_name,
        "project_name": project_name,
        "quoted_price": project.quoted_price,
        "job_category": category,
        "project_start_date": project.project_start_date,
        "project_end_date": project.project_end_date,
        "created_by": project.created_by.strip() or "Employee",
        "business_unit": (project.business_unit or "").strip() or None,
        "assigned_reviewer": (project.assigned_reviewer or "").strip() or None,
    }


# ---------------------------------------------------------
# HEALTH
# ---------------------------------------------------------

def log_action(
    conn,
    project_id: int,
    action: str,
    performed_by: str,
    details: str = ""
):
    conn.execute(text("""
        INSERT INTO project_audit_logs
        (project_id, action, performed_by, details)
        VALUES (:project_id, :action, :performed_by, :details)
    """), {
        "project_id": project_id,
        "action": action,
        "performed_by": (performed_by or "System").strip()[:150],
        "details": details,
    })


def get_project_or_404(conn, project_id: int):
    project = conn.execute(
        text("SELECT * FROM projects WHERE id = :id"),
        {"id": project_id},
    ).mappings().first()

    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")

    return project


def validate_project_dates(start_date, end_date):
    if start_date and end_date and end_date < start_date:
        raise HTTPException(
            status_code=400,
            detail="Project end date cannot be before project start date.",
        )


def project_values(project):
    validate_project_dates(
        project.project_start_date,
        project.project_end_date
    )

    client_name = project.client_name.strip()
    project_name = project.project_name.strip()
    category = project.job_category.strip()

    if not client_name or not project_name or not category:
        raise HTTPException(
            status_code=400,
            detail="Required project fields cannot be empty."
        )

    return {
        "client_name": client_name,
        "project_name": project_name,
        "quoted_price": project.quoted_price,
        "job_category": category,
        "project_start_date": project.project_start_date,
        "project_end_date": project.project_end_date,
        "created_by": project.created_by.strip() or "Employee",
        "business_unit": (project.business_unit or "").strip() or None,
        "assigned_reviewer": (project.assigned_reviewer or "").strip() or None,
    }


# ---------------------------------------------------------
# HEALTH APIs
# ---------------------------------------------------------

@app.get("/")
def home():
    return {"message": "ProjectFlow API is running!"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/db-test")
def test_database():
    try:
        with engine.connect() as conn:
            version = conn.execute(
                text("SELECT version()")
            ).scalar()

        return {"database": version}

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Database connection failed. Check DATABASE_URL."
        )


# ---------------------------------------------------------
# PROJECT APIs
# ---------------------------------------------------------

@app.post("/projects")
def create_project(project: ProjectCreate):
    values = project_values(project)

    with engine.begin() as conn:
        result = conn.execute(text("""
            INSERT INTO projects (
                client_name, project_name, quoted_price, job_category, status,
                project_start_date, project_end_date, created_by, business_unit,
                assigned_reviewer, version_number, is_active
            )
            VALUES (
                :client_name, :project_name, :quoted_price, :job_category, 'Pending',
                :project_start_date, :project_end_date, :created_by, :business_unit,
                :assigned_reviewer, 1, TRUE
            )
            RETURNING *
        """), values)

        project_row = dict(result.mappings().one())

        conn.execute(text("""
            UPDATE projects
            SET root_project_id = :id
            WHERE id = :id
        """), {"id": project_row["id"]})

        log_action(
            conn,
            project_row["id"],
            "Project created",
            values["created_by"],
            "Project submitted using the legacy create flow."
        )

        return project_row


@app.post("/projects/draft")
def create_initial_project_draft(project: ProjectDraftUpdate):
    values = project_values(project)

    with engine.begin() as conn:
        result = conn.execute(text("""
            INSERT INTO projects (
                client_name, project_name, quoted_price, job_category, status,
                manager_comment, reviewed_at, reviewed_by,
                project_start_date, project_end_date, created_by, business_unit,
                assigned_reviewer, version_number, root_project_id, is_active
            )
            VALUES (
                :client_name, :project_name, :quoted_price, :job_category, 'Draft',
                NULL, NULL, NULL,
                :project_start_date, :project_end_date, :created_by, :business_unit,
                :assigned_reviewer, 1, NULL, FALSE
            )
            RETURNING *
        """), values)

        draft = dict(result.mappings().one())

        conn.execute(text("""
            UPDATE projects
            SET root_project_id = :id
            WHERE id = :id
        """), {"id": draft["id"]})

        log_action(
            conn,
            draft["id"],
            "Draft created",
            values["created_by"],
            "Initial project draft created."
        )

        return dict(get_project_or_404(conn, draft["id"]))


@app.get("/projects")
def get_projects():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT *
            FROM projects
            ORDER BY id DESC
        """)).mappings().all()

        return [dict(row) for row in rows]


@app.get("/projects/{project_id}")
def get_project(project_id: int):
    with engine.connect() as conn:
        return dict(get_project_or_404(conn, project_id))


@app.post("/projects/{project_id}/draft")
def create_project_version(
    project_id: int,
    update: ProjectDraftUpdate
):
    values = project_values(update)

    with engine.begin() as conn:
        original = get_project_or_404(conn, project_id)

        root_id = original["root_project_id"] or original["id"]

        latest_version = conn.execute(text("""
            SELECT COALESCE(MAX(version_number), 1)
            FROM projects
            WHERE root_project_id = :root_id OR id = :root_id
        """), {"root_id": root_id}).scalar()

        new_version = int(latest_version or 1) + 1

        result = conn.execute(text("""
            INSERT INTO projects (
                client_name, project_name, quoted_price, job_category, status,
                manager_comment, reviewed_at, reviewed_by,
                project_start_date, project_end_date, created_by, business_unit,
                assigned_reviewer, version_number, root_project_id, is_active
            )
            VALUES (
                :client_name, :project_name, :quoted_price, :job_category, 'Draft',
                NULL, NULL, NULL,
                :project_start_date, :project_end_date, :created_by, :business_unit,
                :assigned_reviewer, :version_number, :root_project_id, FALSE
            )
            RETURNING *
        """), {
            **values,
            "version_number": new_version,
            "root_project_id": root_id,
        })

        draft = dict(result.mappings().one())

        log_action(
            conn,
            draft["id"],
            "Draft version created",
            values["created_by"],
            f"Created version {new_version} from project {project_id}."
        )

        return draft


@app.put("/projects/{project_id}/draft")
def update_project_draft(
    project_id: int,
    update: ProjectDraftUpdate
):
    values = project_values(update)

    with engine.begin() as conn:
        current = get_project_or_404(conn, project_id)

        if current["status"] not in ("Draft", "Rejected"):
            raise HTTPException(
                status_code=400,
                detail="Only draft or rejected projects can be edited."
            )

        conn.execute(text("""
            UPDATE projects SET
                client_name = :client_name,
                project_name = :project_name,
                quoted_price = :quoted_price,
                job_category = :job_category,
                project_start_date = :project_start_date,
                project_end_date = :project_end_date,
                created_by = :created_by,
                business_unit = :business_unit,
                assigned_reviewer = :assigned_reviewer,
                status = 'Draft',
                manager_comment = NULL,
                reviewed_at = NULL,
                reviewed_by = NULL
            WHERE id = :id
        """), {
            **values,
            "id": project_id
        })

        log_action(
            conn,
            project_id,
            "Draft updated",
            values["created_by"],
            "Project draft details updated."
        )

        return dict(get_project_or_404(conn, project_id))


@app.post("/projects/{project_id}/submit")
def submit_project(
    project_id: int,
    submitted_by: str = Form("Employee")
):
    with engine.begin() as conn:
        project = get_project_or_404(conn, project_id)

        if project["status"] not in ("Draft", "Rejected"):
            raise HTTPException(
                status_code=400,
                detail="Only draft or rejected projects can be submitted."
            )

        contract_count = conn.execute(text("""
            SELECT COUNT(*)
            FROM project_contracts
            WHERE project_id = :id
        """), {"id": project_id}).scalar()

        category_count = conn.execute(text("""
            SELECT COUNT(*)
            FROM project_job_categories
            WHERE project_id = :id
        """), {"id": project_id}).scalar()

        if not project["job_category"] and not category_count:
            raise HTTPException(
                status_code=400,
                detail="At least one job category is required."
            )

        if not contract_count:
            raise HTTPException(
                status_code=400,
                detail="Upload at least one contract before submitting."
            )

        if not project["assigned_reviewer"]:
            raise HTTPException(
                status_code=400,
                detail="Select a reviewer before submitting."
            )

        if not project["project_start_date"] or not project["project_end_date"]:
            raise HTTPException(
                status_code=400,
                detail="Project start date and end date are required before submitting."
            )

        if not project["business_unit"]:
            raise HTTPException(
                status_code=400,
                detail="Business unit is required before submitting."
            )

        validate_project_dates(project["project_start_date"], project["project_end_date"])

        conn.execute(text("""
            UPDATE projects
            SET status = 'Pending',
                manager_comment = NULL,
                reviewed_at = NULL,
                reviewed_by = NULL
            WHERE id = :id
        """), {"id": project_id})

        log_action(
            conn,
            project_id,
            "Submitted for approval",
            submitted_by,
            "Project submitted to the assigned reviewer."
        )

        return dict(get_project_or_404(conn, project_id))


@app.put("/projects/{project_id}/review")
def review_project(
    project_id: int,
    review: ManagerReview
):
    if review.status not in ("Approved", "Rejected"):
        raise HTTPException(
            status_code=400,
            detail="Status must be Approved or Rejected."
        )

    comment = review.manager_comment.strip()
    reviewer = review.reviewed_by.strip()

    if not reviewer:
        raise HTTPException(
            status_code=400,
            detail="Reviewer name is required."
        )

    if review.status == "Rejected" and not comment:
        raise HTTPException(
            status_code=400,
            detail="A rejection reason is required."
        )

    with engine.begin() as conn:
        project = get_project_or_404(conn, project_id)

        if project["status"] != "Pending":
            raise HTTPException(
                status_code=400,
                detail="Only pending projects can be reviewed."
            )

        result = conn.execute(text("""
            UPDATE projects
            SET status = :status,
                manager_comment = :comment,
                reviewed_by = :reviewed_by,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE id = :id
            RETURNING *
        """), {
            "status": review.status,
            "comment": comment,
            "reviewed_by": reviewer,
            "id": project_id,
        })

        updated = dict(result.mappings().one())

        if review.status == "Approved":
            root_id = project["root_project_id"] or project["id"]

            conn.execute(text("""
                UPDATE projects
                SET is_active = FALSE
                WHERE root_project_id = :root_id OR id = :root_id
            """), {"root_id": root_id})

            conn.execute(text("""
                UPDATE projects
                SET is_active = TRUE
                WHERE id = :id
            """), {"id": project_id})

        log_action(
            conn,
            project_id,
            review.status,
            reviewer,
            comment or f"Project {review.status.lower()}."
        )

        return updated


@app.get("/projects/{project_id}/versions")
def get_project_versions(project_id: int):
    with engine.connect() as conn:
        project = get_project_or_404(conn, project_id)
        root_id = project["root_project_id"] or project["id"]

        rows = conn.execute(text("""
            SELECT *
            FROM projects
            WHERE root_project_id = :root_id OR id = :root_id
            ORDER BY version_number DESC, id DESC
        """), {"root_id": root_id}).mappings().all()

        return [dict(row) for row in rows]


@app.get("/projects/{project_id}/audit")
def get_project_audit(project_id: int):
    with engine.connect() as conn:
        get_project_or_404(conn, project_id)

        rows = conn.execute(text("""
            SELECT *
            FROM project_audit_logs
            WHERE project_id = :id
            ORDER BY created_at DESC, id DESC
        """), {"id": project_id}).mappings().all()

        return [dict(row) for row in rows]
    # ---------------------------------------------------------
# JOB CATEGORY / MOCK RATE CARD APIs
# ---------------------------------------------------------

@app.get("/rate-cards")
def get_rate_cards():
    return [
        {
            "code": code,
            "category": details["category"],
            "rate": float(details["rate"])
        }
        for code, details in RATE_CARDS.items()
    ]


@app.post("/projects/{project_id}/job-categories")
def save_job_categories(
    project_id: int,
    payload: JobCategoriesUpdate
):
    if not payload.categories:
        raise HTTPException(
            status_code=400,
            detail="Add at least one job category."
        )

    cleaned_categories = []
    seen_categories = set()

    for item in payload.categories:
        category_name = item.category_name.strip()
        rate_card_code = item.rate_card_code.strip()

        if not category_name:
            raise HTTPException(
                status_code=400,
                detail="Job category name cannot be empty."
            )

        if not rate_card_code:
            raise HTTPException(
                status_code=400,
                detail="Rate card selection is required."
            )

        if rate_card_code not in RATE_CARDS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid rate card code: {rate_card_code}"
            )

        expected_rate = RATE_CARDS[rate_card_code]["rate"]

        if item.rate_amount != expected_rate:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Rate amount for {rate_card_code} must be "
                    f"{expected_rate}."
                )
            )

        normalized_name = category_name.casefold()

        if normalized_name in seen_categories:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate job category: {category_name}"
            )

        seen_categories.add(normalized_name)

        cleaned_categories.append({
            "category_name": category_name,
            "rate_card_code": rate_card_code,
            "rate_amount": expected_rate
        })

    with engine.begin() as conn:
        get_project_or_404(conn, project_id)

        conn.execute(
            text("""
                DELETE FROM project_job_categories
                WHERE project_id = :id
            """),
            {"id": project_id}
        )

        for item in cleaned_categories:
            conn.execute(text("""
                INSERT INTO project_job_categories (
                    project_id,
                    category_name,
                    rate_card_code,
                    rate_amount
                )
                VALUES (
                    :project_id,
                    :category_name,
                    :rate_card_code,
                    :rate_amount
                )
            """), {
                "project_id": project_id,
                **item
            })

        log_action(
            conn,
            project_id,
            "Job categories updated",
            "Employee",
            f"Saved {len(cleaned_categories)} job category item(s)."
        )

        rows = conn.execute(text("""
            SELECT *
            FROM project_job_categories
            WHERE project_id = :id
            ORDER BY id
        """), {"id": project_id}).mappings().all()

        return [dict(row) for row in rows]


@app.get("/projects/{project_id}/job-categories")
def get_job_categories(project_id: int):
    with engine.connect() as conn:
        get_project_or_404(conn, project_id)

        rows = conn.execute(text("""
            SELECT *
            FROM project_job_categories
            WHERE project_id = :id
            ORDER BY id
        """), {"id": project_id}).mappings().all()

        return [dict(row) for row in rows]


# ---------------------------------------------------------
# CLIENT APIs
# ---------------------------------------------------------

@app.post("/clients")
def create_client(client: ClientCreate):

    client_name = client.client_name.strip()
    legal_entity = client.legal_entity.strip()
    registered_address = client.registered_address.strip()
    billing_address = client.billing_address.strip() or registered_address
    payment_mode = client.payment_mode.strip()
    currency = client.currency.strip().upper()
    contact_name = client.primary_contact_name.strip()
    contact_designation = client.primary_contact_designation.strip()
    contact_email = client.primary_contact_email.strip()
    contact_phone = client.primary_contact_phone.strip()

    required_values = {
        "Client name": client_name,
        "Legal entity": legal_entity,
        "Registered address": registered_address,
        "Payment mode": payment_mode,
        "Primary contact name": contact_name,
        "Primary contact email": contact_email,
        "Primary contact phone": contact_phone,
    }

    for field_name, value in required_values.items():
        if not value:
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} is required."
            )

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        contact_email
    ):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid contact email address."
        )

    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise HTTPException(
            status_code=400,
            detail="Currency must be a valid 3-letter code."
        )

    gst_number = client.gst_number.strip().upper()

    if not re.fullmatch(
        r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]",
        gst_number
    ):
        raise HTTPException(
            status_code=400,
            detail="Please enter a valid 15-character GST number."
        )

    with engine.begin() as conn:

        if gst_number:
            exists = conn.execute(text("""
                SELECT id
                FROM clients
                WHERE UPPER(gst_number) = :gst
            """), {"gst": gst_number}).first()

            if exists:
                raise HTTPException(
                    status_code=409,
                    detail="A client with this GST number already exists."
                )

        result = conn.execute(text("""
            INSERT INTO clients (
                client_name,
                legal_entity,
                registered_address,
                billing_address,
                gst_number,
                payment_mode,
                currency,
                primary_contact_name,
                primary_contact_designation,
                primary_contact_email,
                primary_contact_phone
            )
            VALUES (
                :client_name,
                :legal_entity,
                :registered_address,
                :billing_address,
                :gst_number,
                :payment_mode,
                :currency,
                :contact_name,
                :contact_designation,
                :contact_email,
                :contact_phone
            )
            RETURNING *
        """), {
            "client_name": client_name,
            "legal_entity": legal_entity,
            "registered_address": registered_address,
            "billing_address": billing_address,
            "gst_number": gst_number,
            "payment_mode": payment_mode,
            "currency": currency,
            "contact_name": contact_name,
            "contact_designation": contact_designation,
            "contact_email": contact_email,
            "contact_phone": contact_phone,
        })

        return dict(result.mappings().one())


@app.get("/clients")
def get_clients():
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT *
            FROM clients
            ORDER BY id ASC
        """)).mappings().all()

        return [dict(row) for row in rows]


@app.get("/clients/{client_id}")
def get_client(client_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM clients WHERE id = :id"),
            {"id": client_id}
        ).mappings().first()

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Client not found."
            )

        return dict(row)
# ---------------------------------------------------------
# CONTRACT APIs
# ---------------------------------------------------------

@app.post("/projects/{project_id}/contracts")
async def upload_contract(
    project_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    valid_from: Optional[str] = Form(None),
    valid_to: Optional[str] = Form(None),
):
    document_type = (document_type or "").strip()

    if not document_type or len(document_type) > 80:
        raise HTTPException(
            status_code=400,
            detail="Enter a valid contract document type."
        )

    original_filename = Path(file.filename or "").name

    if not original_filename:
        raise HTTPException(
            status_code=400,
            detail="Please select a contract file."
        )

    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOC, and DOCX files are allowed."
        )

    try:
        data = await file.read(MAX_CONTRACT_SIZE + 1)

        if not data:
            raise HTTPException(
                status_code=400,
                detail="The selected file is empty."
            )

        if len(data) > MAX_CONTRACT_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Contract file must be 10 MB or smaller."
            )

        try:
            from_date = date.fromisoformat(valid_from) if valid_from else None
            to_date = date.fromisoformat(valid_to) if valid_to else None
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Enter valid contract dates."
            )

        if from_date and to_date and to_date < from_date:
            raise HTTPException(
                status_code=400,
                detail="Validity end date cannot be before start date."
            )

        # Check the project before saving the file.
        with engine.connect() as conn:
            get_project_or_404(conn, project_id)

        stored_filename = f"{uuid4().hex}{extension}"

        folder = CONTRACTS_DIR / str(project_id)
        folder.mkdir(parents=True, exist_ok=True)

        destination = folder / stored_filename
        destination.write_bytes(data)

        try:
            with engine.begin() as conn:
                result = conn.execute(text("""
                    INSERT INTO project_contracts (
                        project_id,
                        original_filename,
                        stored_filename,
                        file_path,
                        content_type,
                        file_size,
                        document_type,
                        valid_from,
                        valid_to
                    )
                    VALUES (
                        :project_id,
                        :original_filename,
                        :stored_filename,
                        :file_path,
                        :content_type,
                        :file_size,
                        :document_type,
                        :valid_from,
                        :valid_to
                    )
                    RETURNING
                        id,
                        project_id,
                        original_filename,
                        content_type,
                        file_size,
                        document_type,
                        valid_from,
                        valid_to,
                        uploaded_at
                """), {
                    "project_id": project_id,
                    "original_filename": original_filename[:255],
                    "stored_filename": stored_filename,
                    "file_path": str(destination),
                    "content_type": file.content_type,
                    "file_size": len(data),
                    "document_type": document_type,
                    "valid_from": from_date,
                    "valid_to": to_date,
                })

                log_action(
                    conn,
                    project_id,
                    "Contract uploaded",
                    "Employee",
                    original_filename
                )

                return dict(result.mappings().one())

        except Exception:
            destination.unlink(missing_ok=True)
            raise

    finally:
        await file.close()


@app.get("/projects/{project_id}/contracts")
def list_project_contracts(project_id: int):
    with engine.connect() as conn:
        get_project_or_404(conn, project_id)

        rows = conn.execute(text("""
            SELECT
                id,
                project_id,
                original_filename,
                content_type,
                file_size,
                document_type,
                valid_from,
                valid_to,
                uploaded_at
            FROM project_contracts
            WHERE project_id = :project_id
            ORDER BY uploaded_at DESC, id DESC
        """), {
            "project_id": project_id
        }).mappings().all()

        return [dict(row) for row in rows]


@app.get("/contracts/{contract_id}/download")
def download_contract(contract_id: int):
    with engine.connect() as conn:
        contract = conn.execute(text("""
            SELECT *
            FROM project_contracts
            WHERE id = :id
        """), {
            "id": contract_id
        }).mappings().first()

        if contract is None:
            raise HTTPException(
                status_code=404,
                detail="Contract document not found."
            )

        file_path = Path(contract["file_path"])

    if not file_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="The stored contract file is missing."
        )

    return FileResponse(
        path=file_path,
        media_type=contract["content_type"] or "application/octet-stream",
        filename=contract["original_filename"],
    )


@app.delete("/contracts/{contract_id}")
def delete_contract(contract_id: int):
    with engine.begin() as conn:
        contract = conn.execute(text("""
            SELECT *
            FROM project_contracts
            WHERE id = :id
        """), {
            "id": contract_id
        }).mappings().first()

        if contract is None:
            raise HTTPException(
                status_code=404,
                detail="Contract document not found."
            )

        conn.execute(text("""
            DELETE FROM project_contracts
            WHERE id = :id
        """), {
            "id": contract_id
        })

        log_action(
            conn,
            contract["project_id"],
            "Contract deleted",
            "Employee",
            contract["original_filename"]
        )

        file_path = Path(contract["file_path"])

    file_path.unlink(missing_ok=True)

    return {
        "message": "Contract document deleted successfully."
    }
# ---------------------------------------------------------
# MOCK RATE CARDS
# ---------------------------------------------------------

RATE_CARDS = {
    "DEV-JR": {
        "category": "Software Development - Junior",
        "rate": Decimal("1200")
    },
    "DEV-SR": {
        "category": "Software Development - Senior",
        "rate": Decimal("2200")
    },
    "QA": {
        "category": "Quality Assurance",
        "rate": Decimal("1000")
    },
    "DATA": {
        "category": "Data & Analytics",
        "rate": Decimal("1800")
    },
    "UIUX": {
        "category": "UI/UX Design",
        "rate": Decimal("1500")
    },
    "PM": {
        "category": "Project Management",
        "rate": Decimal("2000")
    }
}