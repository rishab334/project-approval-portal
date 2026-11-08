import { useCallback, useEffect, useMemo, useState } from "react";
import Login from "./login";
import "./App.css";

const API = "http://127.0.0.1:8000";
const EMPTY_FORM = {
  client: "",
  name: "",
  price: "",
  category: "",
  startDate: "",
  endDate: "",
  businessUnit: "",
  reviewer: "",
};

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(Array.isArray(detail) ? detail.map((x) => x.msg).join(", ") : detail || "Request failed.");
  }
  return data;
}

function App() {
  const [role, setRole] = useState(sessionStorage.getItem("projectflowRole") || "");
  const [section, setSection] = useState(
    sessionStorage.getItem("projectflowRole") === "manager" ? "pending" : "all"
  );
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [rateCards, setRateCards] = useState([]);
  const [comments, setComments] = useState({});
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [existingContractCount, setExistingContractCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState("newest");
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [documentType, setDocumentType] = useState("Master Service Agreement");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [jobItems, setJobItems] = useState([{ category: "", rateCode: "" }]);
  const [detailProject, setDetailProject] = useState(null);
  const [details, setDetails] = useState({ contracts: [], versions: [], audit: [], jobs: [] });
  const [clientForm, setClientForm] = useState({
    client_name: "", legal_entity: "", registered_address: "", billing_address: "",
    gst_number: "", payment_mode: "Bank Transfer", currency: "INR",
    primary_contact_name: "", primary_contact_designation: "", primary_contact_email: "", primary_contact_phone: "",
  });
  const [selectedClientDetails, setSelectedClientDetails] = useState(null);
  const [showClientForm, setShowClientForm] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await apiRequest("/projects");
      setProjects(Array.isArray(data) ? data : []);
      setBackendStatus("Connected");
    } catch (error) {
      console.error(error);
      setBackendStatus("Backend not connected");
    }
  }, []);

  const fetchReferenceData = useCallback(async () => {
    try {
      const [clientData, rateData] = await Promise.all([
        apiRequest("/clients"),
        apiRequest("/rate-cards"),
      ]);
      setClients(Array.isArray(clientData) ? clientData : []);
      setSelectedClientDetails((current) => {
        if (!current) return current;
        return (Array.isArray(clientData) ? clientData : []).find(
          (client) => client.id === current.id || client.client_name === current.client_name
        ) || current;
      });
      setRateCards(Array.isArray(rateData) ? rateData : []);
    } catch (error) {
      console.error("Reference data:", error);
    }
  }, []);

  useEffect(() => {
    apiRequest("/health")
      .then(() => setBackendStatus("Connected"))
      .catch(() => setBackendStatus("Backend not connected"));
    fetchProjects();
    fetchReferenceData();
  }, [fetchProjects, fetchReferenceData]);

  function handleLogin(selectedRole) {
    sessionStorage.setItem("projectflowRole", selectedRole);
    setRole(selectedRole);
    setSection(selectedRole === "manager" ? "pending" : "all");
  }

  function handleLogout() {
    sessionStorage.removeItem("projectflowRole");
    setRole("");
    setSection("all");
    setShowForm(false);
    setDetailProject(null);
  }

  function openSection(value) {
    setSection(value);
    setSearchTerm("");
    setStatusFilter("All");
    setSortOrder("newest");
    setShowForm(false);
    setDetailProject(null);
  }

  function updateForm(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function updateJobItem(index, key, value) {
    setJobItems((previous) => previous.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  function addJobItem() {
    setJobItems((previous) => [...previous, { category: "", rateCode: "" }]);
  }

  function removeJobItem(index) {
    setJobItems((previous) => previous.filter((_, i) => i !== index));
  }

  async function saveClient(e) {
    e.preventDefault();
    setFormError("");
    try {
      const created = await apiRequest("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientForm),
      });
      await fetchReferenceData();
      setForm((previous) => ({ ...previous, client: created.client_name }));
      setSelectedClientDetails(created);
      setShowClientForm(false);
      setClientForm({
        client_name: "", legal_entity: "", registered_address: "", billing_address: "",
        gst_number: "", payment_mode: "Bank Transfer", currency: "INR",
        primary_contact_name: "", primary_contact_designation: "", primary_contact_email: "", primary_contact_phone: "",
      });
      setNotice("Client saved successfully.");
    } catch (error) {
      setFormError(error.message);
    }
  }

  async function uploadContracts(projectId) {
    for (const file of selectedFiles) {
      const body = new FormData();
      body.append("file", file);
      body.append("document_type", documentType);
      if (validFrom) body.append("valid_from", validFrom);
      if (validTo) body.append("valid_to", validTo);
      await apiRequest(`/projects/${projectId}/contracts`, { method: "POST", body });
    }
  }

  async function saveCategories(projectId) {
    const categories = jobItems.map((item) => {
      const selected = rateCards.find((rate) => rate.code === item.rateCode);
      if (!selected || !item.category.trim()) throw new Error("Choose a category and rate card for every job category.");
      return {
        category_name: item.category.trim(),
        rate_card_code: selected.code,
        rate_amount: Number(selected.rate),
      };
    });
    await apiRequest(`/projects/${projectId}/job-categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    });
  }

  async function startEditing(project) {
    setFormError("");
    setNotice("");
    try {
      const [jobs, contracts] = await Promise.all([
        apiRequest(`/projects/${project.id}/job-categories`),
        apiRequest(`/projects/${project.id}/contracts`),
      ]);

      setEditingProjectId(project.id);
      setSelectedClientDetails(
        clients.find((client) => client.client_name === project.client_name) || null
      );
      setExistingContractCount(Array.isArray(contracts) ? contracts.length : 0);
      setForm({
        client: project.client_name || "",
        name: project.project_name || "",
        price: project.quoted_price ?? "",
        category: project.job_category || "",
        startDate: project.project_start_date || "",
        endDate: project.project_end_date || "",
        businessUnit: project.business_unit || "",
        reviewer: project.assigned_reviewer || "",
      });

      setJobItems(
        Array.isArray(jobs) && jobs.length
          ? jobs.map((job) => ({
              category: job.category_name || "",
              rateCode: job.rate_card_code || "",
            }))
          : [{ category: project.job_category || "", rateCode: "" }]
      );
      setSelectedFiles([]);
      setShowForm(true);
      setDetailProject(null);
      setSection("all");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      alert(`Unable to load project for editing: ${error.message}`);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setNotice("");

    // 1. Validate required fields individually so each field gets a clear message.
    const client = (form.client || "").trim();
    const name = (form.name || "").trim();
    const reviewer = (form.reviewer || "").trim();
    const category =
      (form.category || "").trim() || (jobItems[0]?.category || "").trim();
    const price = Number(form.price);

    if (!client) {
      setFormError("Please select a client.");
      return;
    }

    // This catches empty strings and names containing only spaces.
    // Spaces between words remain valid, e.g. "Employee Management System".
    if (!name) {
      setFormError("Please enter a project name.");
      return;
    }

    if (name.length < 2 || name.length > 120) {
      setFormError("Project name must contain between 2 and 120 characters.");
      return;
    }

    if (!reviewer) {
      setFormError("Please enter the assigned reviewer.");
      return;
    }

    // 2. Quoted price validation
    if (!Number.isFinite(price) || price <= 0) {
      setFormError("Enter a valid quoted price greater than zero.");
      return;
    }

    // 3. Project date validation
    if (
      form.startDate &&
      form.endDate &&
      form.endDate < form.startDate
    ) {
      setFormError("Project end date cannot be earlier than the start date.");
      return;
    }

    // 4. Contract validation
    if (!selectedFiles.length && existingContractCount === 0) {
      setFormError("Please upload at least one contract before submitting.");
      return;
    }

    if (!(documentType || "").trim()) {
      setFormError("Please enter the contract document type.");
      return;
    }

    if (validFrom && validTo && validTo < validFrom) {
      setFormError(
        "Contract validity end date cannot be earlier than its start date."
      );
      return;
    }

    // 5. Job category and rate card validation
    if (!Array.isArray(jobItems) || jobItems.length === 0) {
      setFormError("Add at least one job category.");
      return;
    }

    const invalidJob = jobItems.some((item) => {
      const selectedRate = rateCards.find(
        (rate) => rate.code === item.rateCode
      );

      return (
        !(item.category || "").trim() ||
        !item.rateCode ||
        !selectedRate ||
        !Number.isFinite(Number(selectedRate?.rate)) ||
        Number(selectedRate?.rate) <= 0
      );
    });

    if (invalidJob) {
      setFormError(
        "Enter a valid job category and select a matching rate card for every category."
      );
      return;
    }

    if (!category) {
      setFormError("Please enter at least one job category.");
      return;
    }

    setSubmitLoading(true);

    try {
      const payload = {
        client_name: client,
        project_name: name,
        quoted_price: price,
        job_category: category,
        project_start_date: form.startDate || null,
        project_end_date: form.endDate || null,
        created_by: role === "employee" ? "Employee" : "Manager",
        business_unit: (form.businessUnit || "").trim() || null,
        assigned_reviewer: reviewer,
      };

      const draft = editingProjectId
        ? await apiRequest(`/projects/${editingProjectId}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await apiRequest("/projects/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      const projectId = draft.id || editingProjectId;

      await saveCategories(projectId);
      await uploadContracts(projectId);

      const body = new FormData();
      body.append("submitted_by", payload.created_by);

      await apiRequest(`/projects/${projectId}/submit`, {
        method: "POST",
        body,
      });

      await fetchProjects();

      setForm(EMPTY_FORM);
      setSelectedFiles([]);
      setJobItems([{ category: "", rateCode: "" }]);
      setEditingProjectId(null);
      setExistingContractCount(0);
      setShowForm(false);
      setSection("all");
      setNotice(`Project #${projectId} submitted for approval.`);
    } catch (error) {
      console.error("Project submission:", error);

      setFormError(
        `${error.message} If a draft was created before this error, it remains available in the project list.`
      );

      await fetchProjects();
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleReview(projectId, status) {
    const comment = (comments[projectId] || "").trim();
    if (status === "Rejected" && !comment) {
      alert("Please enter a reason before rejecting this project.");
      return;
    }
    if (!window.confirm(`Are you sure you want to ${status.toLowerCase()} this project?`)) return;
    setLoading(true);
    try {
      await apiRequest(`/projects/${projectId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          manager_comment: comment,
          reviewed_by: "Manager",
        }),
      });
      await fetchProjects();
      setComments((previous) => ({ ...previous, [projectId]: "" }));
      setNotice(`Project ${status.toLowerCase()} successfully.`);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function openDetails(project) {
    setDetailProject(project);
    setDetails({ contracts: [], versions: [], audit: [], jobs: [] });
    try {
      const [contracts, versions, audit, jobs] = await Promise.all([
        apiRequest(`/projects/${project.id}/contracts`),
        apiRequest(`/projects/${project.id}/versions`),
        apiRequest(`/projects/${project.id}/audit`),
        apiRequest(`/projects/${project.id}/job-categories`),
      ]);
      setDetails({ contracts, versions, audit, jobs });
    } catch (error) {
      setNotice(`Unable to load all project details: ${error.message}`);
    }
  }

  async function downloadContract(contractId, filename) {
    try {
      const response = await fetch(`${API}/contracts/${contractId}/download`);
      if (!response.ok) throw new Error("Unable to download contract.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "contract";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message);
    }
  }

  async function deleteContract(contractId) {
    if (!window.confirm("Delete this contract attachment?")) return;
    try {
      await apiRequest(`/contracts/${contractId}`, { method: "DELETE" });
      if (detailProject) await openDetails(detailProject);
      setNotice("Contract deleted.");
    } catch (error) {
      alert(error.message);
    }
  }

  async function createNewVersion(project) {
    if (!window.confirm(`Create a new draft version of "${project.project_name}"?`)) return;
    try {
      const draft = await apiRequest(`/projects/${project.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: project.client_name,
          project_name: project.project_name,
          quoted_price: Number(project.quoted_price),
          job_category: project.job_category || "General",
          project_start_date: project.project_start_date || null,
          project_end_date: project.project_end_date || null,
          created_by: "Employee",
          business_unit: project.business_unit || null,
          assigned_reviewer: "",
        }),
      });
      await fetchProjects();
      setNotice(`Draft version #${draft.id} created. Complete its details and attachments before submitting.`);
    } catch (error) {
      alert(error.message);
    }
  }

  const total = projects.length;
  const pending = projects.filter((p) => p.status?.toLowerCase() === "pending").length;
  const approved = projects.filter((p) => p.status?.toLowerCase() === "approved").length;
  const rejected = projects.filter((p) => p.status?.toLowerCase() === "rejected").length;
  const drafts = projects.filter((p) => p.status?.toLowerCase() === "draft").length;

  const sectionTitles = {
    all: "All Projects",
    pending: "Pending Approvals",
    approved: "Approved Projects",
    rejected: "Rejected Projects",
    drafts: "Draft Projects",
  };

  const sectionProjects = projects.filter((p) => {
    if (section === "pending" || section === "approved" || section === "rejected" || section === "drafts") {
      return p.status?.toLowerCase() === (section === "drafts" ? "draft" : section);
    }
    return true;
  });

  const visibleProjects = useMemo(() => sectionProjects
    .filter((p) => {
      const search = searchTerm.toLowerCase().trim();
      const matchesSearch = !search ||
        p.client_name?.toLowerCase().includes(search) ||
        p.project_name?.toLowerCase().includes(search) ||
        String(p.id).includes(search);
      const matchesStatus = statusFilter === "All" || p.status?.toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortOrder === "oldest") return Number(a.id) - Number(b.id);
      if (sortOrder === "highest") return Number(b.quoted_price) - Number(a.quoted_price);
      if (sortOrder === "lowest") return Number(a.quoted_price) - Number(b.quoted_price);
      return Number(b.id) - Number(a.id);
    }), [sectionProjects, searchTerm, statusFilter, sortOrder]);

  if (!role) return <Login onLogin={handleLogin} />;

  const inputStyle = { width: "100%", padding: "10px", margin: "5px 0 12px", border: "1px solid #d9dfeb", borderRadius: "7px", boxSizing: "border-box" };
  const labelStyle = { display: "block", fontWeight: 600, marginTop: "5px" };
  const panelStyle = { background: "#fff", padding: "18px", borderRadius: "10px", marginBottom: "18px", boxShadow: "0 2px 10px rgba(20,35,70,.05)" };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>ProjectFlow</h2>
        <p className="side-label">WORKSPACE</p>
        {[
          ["all", "▦ All Projects"],
          ["pending", `◷ Pending Approvals (${pending})`],
          ["approved", `✓ Approved Projects (${approved})`],
          ["rejected", `✕ Rejected Projects (${rejected})`],
          ...(role === "employee" ? [["drafts", `▤ Draft Projects (${drafts})`]] : []),
        ].map(([key, label]) => (
          <div key={key} className={`nav ${section === key ? "active" : ""}`} role="button" tabIndex={0} onClick={() => openSection(key)} onKeyDown={(e) => e.key === "Enter" && openSection(key)}>
            {label}
          </div>
        ))}
        <div className="sidebar-bottom">Project Approval Portal</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{role === "manager" ? "Manager Dashboard" : "Employee Dashboard"}</h1>
            <p>Manage and track your projects.</p>
            <p>Backend Status: <strong>{backendStatus}</strong></p>
          </div>
          <div className="profile">
            {role === "manager" ? "Manager" : "Employee"}
            <button onClick={handleLogout}>Logout</button>
          </div>
        </header>

        <section className="stats">
          {[
            ["Total Projects", total, "All project records"],
            ["Pending Approvals", pending, "Awaiting manager review"],
            ["Approved Projects", approved, "Successfully approved"],
            ["Rejected Projects", rejected, "Projects requiring changes"],
          ].map(([label, value, helper]) => (
            <div className="stat-card" key={label}><span>{label}</span><h2>{value}</h2><small>{helper}</small></div>
          ))}
        </section>

        <section className="projects-section">
          <div className="section-heading">
            <div><h2>{sectionTitles[section]}</h2><p>Manage project records, versions and approvals.</p></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => { fetchProjects(); fetchReferenceData(); }}>Refresh Projects</button>
              {role === "employee" && <button onClick={() => { setShowForm((v) => !v); setFormError(""); setNotice(""); }}>+ Create New Project</button>}
            </div>
          </div>

          {notice && <p role="status" style={{ ...panelStyle, padding: 12, color: "#176b3a" }}>{notice}</p>}

          {role === "employee" && showForm && (
            <form className="project-form" onSubmit={handleSubmit} style={panelStyle}>
              <h2>{editingProjectId ? `Edit Project #${editingProjectId}` : "Create Project Draft & Submit"}</h2>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <label style={labelStyle}>Client *</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select required value={form.client} onChange={(e) => {
                  const selectedClient = clients.find((client) => client.client_name === e.target.value);
                  updateForm("client", e.target.value);
                  setSelectedClientDetails(selectedClient || null);
                }} style={{ ...inputStyle, flex: 1, minWidth: 200 }}>
                  <option value="">Select existing client</option>
                  {clients.map((client) => <option key={client.id} value={client.client_name}>{client.client_name}</option>)}
                </select>
                <button type="button" onClick={() => { setShowClientForm((v) => !v); setFormError(""); }}>+ Add Client</button>
              </div>

              {selectedClientDetails && !showClientForm && (
                <div style={{ border: "1px solid #d9dfeb", borderRadius: 8, padding: 14, margin: "8px 0 14px", background: "#f8fafc" }}>
                  <h3>Selected Client Details</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
                    {[
                      ["Legal entity", selectedClientDetails.legal_entity_name || selectedClientDetails.legal_entity],
                      ["Registered address", selectedClientDetails.registered_address],
                      ["Billing address", selectedClientDetails.billing_address],
                      ["GST number", selectedClientDetails.gst_number],
                      ["Payment mode", selectedClientDetails.mode_of_payment || selectedClientDetails.payment_mode],
                      ["Currency", selectedClientDetails.billing_currency || selectedClientDetails.currency],
                      ["Primary contact", selectedClientDetails.contact_name || selectedClientDetails.primary_contact_name],
                      ["Designation", selectedClientDetails.contact_designation || selectedClientDetails.primary_contact_designation],
                      ["Email", selectedClientDetails.contact_email || selectedClientDetails.primary_contact_email],
                      ["Phone", selectedClientDetails.contact_phone || selectedClientDetails.primary_contact_phone],
                    ].map(([label, value]) => (
                      <div key={label}><strong>{label}:</strong> {value || "Not provided"}</div>
                    ))}
                  </div>
                </div>
              )}

              {showClientForm && (
                <div style={{ border: "1px solid #e1e6ef", borderRadius: 8, padding: 14, marginBottom: 12 }}>
                  <h3>New Client Details</h3>
                  {[
                    ["client_name", "Client name", "text"],
                    ["legal_entity", "Legal entity", "text"],
                    ["registered_address", "Registered address", "text"],
                    ["billing_address", "Billing address (optional)", "text"],
                    ["gst_number", "GST number *", "text"],
                    ["primary_contact_name", "Primary contact name", "text"],
                    ["primary_contact_designation", "Primary contact designation", "text"],
                    ["primary_contact_email", "Primary contact email", "email"],
                    ["primary_contact_phone", "Primary contact phone", "tel"],
                  ].map(([key, label, type]) => <label key={key} style={labelStyle}>{label}<input style={inputStyle} type={type} value={clientForm[key]} onChange={(e) => setClientForm((p) => ({ ...p, [key]: e.target.value }))} required={key !== "billing_address"} /></label>)}
                  <label style={labelStyle}>Payment mode<select style={inputStyle} value={clientForm.payment_mode} onChange={(e) => setClientForm((p) => ({ ...p, payment_mode: e.target.value }))}><option>Bank Transfer</option><option>UPI</option><option>Cheque</option><option>Credit Card</option></select></label>
                  <label style={labelStyle}>Currency<select style={inputStyle} value={clientForm.currency} onChange={(e) => setClientForm((p) => ({ ...p, currency: e.target.value }))}><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option></select></label>
                  <button type="button" onClick={saveClient}>Save Client</button>
                </div>
              )}

              <label style={labelStyle}>Project name *</label>
              <input style={inputStyle} required minLength={2} maxLength={120} value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Enter project name" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
                <label style={labelStyle}>Quoted price (₹) *<input style={inputStyle} type="number" min="0.01" step="0.01" required value={form.price} onChange={(e) => updateForm("price", e.target.value)} /></label>
                <label style={labelStyle}>Business unit<input style={inputStyle} value={form.businessUnit} onChange={(e) => updateForm("businessUnit", e.target.value)} placeholder="e.g. Technology" /></label>
                <label style={labelStyle}>Project start date<input style={inputStyle} type="date" value={form.startDate} onChange={(e) => updateForm("startDate", e.target.value)} /></label>
                <label style={labelStyle}>Project end date<input style={inputStyle} type="date" value={form.endDate} onChange={(e) => updateForm("endDate", e.target.value)} /></label>
              </div>
              <label style={labelStyle}>Assigned reviewer *</label>
              <input style={inputStyle} required value={form.reviewer} onChange={(e) => updateForm("reviewer", e.target.value)} placeholder="Enter reviewer / manager name" />

              <div style={{ borderTop: "1px solid #e5eaf2", paddingTop: 12, marginTop: 10 }}>
                <h3>Job Categories & Mock Rate Cards *</h3>
                {jobItems.map((item, index) => (
                  <div key={index} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr)) auto", gap: 8, alignItems: "end", marginBottom: 8 }}>
                    <label style={labelStyle}>Job category<input style={inputStyle} required value={item.category} onChange={(e) => updateJobItem(index, "category", e.target.value)} placeholder="e.g. Backend development" /></label>
                    <label style={labelStyle}>Rate card<select style={inputStyle} required value={item.rateCode} onChange={(e) => updateJobItem(index, "rateCode", e.target.value)}><option value="">Select rate card</option>{rateCards.map((rate) => <option key={rate.code} value={rate.code}>{rate.code} — {rate.category} (₹{Number(rate.rate).toLocaleString("en-IN")})</option>)}</select></label>
                    {jobItems.length > 1 && <button type="button" onClick={() => removeJobItem(index)}>Remove</button>}
                  </div>
                ))}
                <button type="button" onClick={addJobItem}>+ Add another job category</button>
              </div>

              <div style={{ borderTop: "1px solid #e5eaf2", paddingTop: 12, marginTop: 12 }}>
                <h3>Contract Attachments *</h3>
                <label style={labelStyle}>Document type<input style={inputStyle} required value={documentType} onChange={(e) => setDocumentType(e.target.value)} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
                  <label style={labelStyle}>Valid from<input style={inputStyle} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
                  <label style={labelStyle}>Valid till<input style={inputStyle} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></label>
                </div>
                <input style={inputStyle} type="file" accept=".pdf,.doc,.docx" multiple onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))} />
                <small>{selectedFiles.length} new file(s) selected. {editingProjectId ? `${existingContractCount} existing contract(s) retained.` : ""} PDF, DOC and DOCX; maximum 10 MB each.</small>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <button type="submit" disabled={submitLoading}>{submitLoading ? "Saving and submitting..." : editingProjectId ? "Save Changes & Resubmit for Approval" : "Create Draft & Submit for Approval"}</button>
                <button type="button" onClick={() => { setShowForm(false); setFormError(""); setEditingProjectId(null); setExistingContractCount(0); setForm(EMPTY_FORM); setSelectedFiles([]); setJobItems([{ category: "", rateCode: "" }]); }}>Cancel</button>
              </div>
            </form>
          )}

          <div className="table-wrapper">
            <h2>{sectionTitles[section]}</h2>
            <div className="project-controls">
              <input type="text" placeholder="Search by client, project or ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="All">All Statuses</option><option>Draft</option><option>Pending</option><option>Approved</option><option>Rejected</option>
              </select>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                <option value="newest">Newest First</option><option value="oldest">Oldest First</option><option value="highest">Highest Price</option><option value="lowest">Lowest Price</option>
              </select>
            </div>
            <p className="results-count">Showing {visibleProjects.length} of {sectionProjects.length} projects</p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>ID</th><th>Client</th><th>Project</th><th>Price</th><th>Status</th><th>Version</th><th>Created by</th><th>Updated</th><th>Actions</th>{role === "manager" && section === "pending" && <th>Manager Review</th>}</tr></thead>
                <tbody>
                  {visibleProjects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}</td><td>{p.client_name}</td><td>{p.project_name}</td>
                      <td>₹{Number(p.quoted_price).toLocaleString("en-IN")}</td>
                      <td><span className={`status ${p.status?.toLowerCase()}`}>{p.status}</span></td>
                      <td>{p.version_number || 1}</td><td>{p.created_by || "—"}</td>
                      <td>{p.reviewed_at ? new Date(p.reviewed_at).toLocaleDateString() : p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</td>
                      <td>
                        <button type="button" onClick={() => openDetails(p)}>Details</button>
                        {role === "employee" && (p.status === "Draft" || p.status === "Rejected") && <button type="button" onClick={() => startEditing(p)} style={{ marginLeft: 5 }}>Edit</button>}
                        {role === "employee" && p.status === "Approved" && <button type="button" onClick={() => createNewVersion(p)} style={{ marginLeft: 5 }}>New version</button>}
                      </td>
                      {role === "manager" && section === "pending" && <td style={{ minWidth: 230 }}>
                        <textarea rows="3" maxLength={500} placeholder="Rejection reason (required only for rejection)" value={comments[p.id] || ""} onChange={(e) => setComments((prev) => ({ ...prev, [p.id]: e.target.value }))} style={inputStyle} />
                        <div style={{ display: "flex", gap: 6 }}><button type="button" disabled={loading} className="approve-btn" onClick={() => handleReview(p.id, "Approved")}>Approve</button><button type="button" disabled={loading} className="reject-btn" onClick={() => handleReview(p.id, "Rejected")}>Reject</button></div>
                      </td>}
                    </tr>
                  ))}
                  {visibleProjects.length === 0 && <tr><td colSpan={role === "manager" && section === "pending" ? 10 : 9}>No projects found in this section.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {detailProject && (
            <section style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <h2>Project Details — #{detailProject.id}</h2>
                <button type="button" onClick={() => setDetailProject(null)}>Close</button>
              </div>
              <p><strong>{detailProject.project_name}</strong> · {detailProject.client_name} · {detailProject.status}</p>
              <h3>Job Categories & Rate Cards</h3>
              {details.jobs.length ? details.jobs.map((job) => <p key={job.id}>{job.category_name} — {job.rate_card_code}: ₹{Number(job.rate_amount).toLocaleString("en-IN")}</p>) : <p>No mapped job categories recorded.</p>}
              <h3>Contract Attachments</h3>
              {details.contracts.length ? details.contracts.map((contract) => (
                <div key={contract.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 8, borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
                  <span>{contract.original_filename} · {contract.document_type}</span>
                  <span><button type="button" onClick={() => downloadContract(contract.id, contract.original_filename)}>Download / View</button> {role === "employee" && <button type="button" onClick={() => deleteContract(contract.id)}>Delete</button>}</span>
                </div>
              )) : <p>No contract attachments.</p>}
              <h3>Version History</h3>
              {details.versions.map((version) => <p key={version.id}>Version {version.version_number || 1} — Project #{version.id} — {version.status}{version.is_active ? " (Active)" : ""}</p>)}
              <h3>Audit Trail</h3>
              {details.audit.length ? details.audit.map((entry) => <p key={entry.id}><strong>{entry.action}</strong> — {entry.performed_by} — {entry.details} <small>{new Date(entry.created_at).toLocaleString()}</small></p>) : <p>No audit entries.</p>}
            </section>
          )}

          {role === "employee" && (
            <div className="table-wrapper">
              <h2>Manager Feedback</h2>
              {projects.filter((p) => p.manager_comment).map((p) => (
                <div key={p.id} style={{ padding: 14, marginBottom: 10, background: "#f5f7fb", borderRadius: 8 }}>
                  <strong>{p.project_name} — {p.status}</strong><p>{p.manager_comment}</p>
                  <small>Reviewed by: {p.reviewed_by || "Manager"}</small>
                </div>
              ))}
              {!projects.some((p) => p.manager_comment) && <p>No manager feedback yet.</p>}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;