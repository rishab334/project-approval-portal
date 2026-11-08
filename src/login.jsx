
import "./login.css";

function Login({ onLogin }) {
  function handleSubmit(e) {
    e.preventDefault();

    const selectedRole = e.currentTarget.elements.role.value;

    onLogin(selectedRole);
  }

  return (
    <div className="login-page">

      <section className="login-brand">
        <div className="brand-logo">
          <span>PF</span>
          ProjectFlow
        </div>

        <div className="brand-content">
          <span className="brand-tag">
            PROJECT MANAGEMENT PLATFORM
          </span>

          <h1>
            Manage projects.
            <br />
            <span>Approve with confidence.</span>
          </h1>

          <p>
            A smarter workspace to submit projects,
            manage approvals and keep every decision
            organized in one place.
          </p>

          <div className="brand-feature">
            <span>✓</span> Centralized project management
          </div>

          <div className="brand-feature">
            <span>✓</span> Streamlined approval workflow
          </div>

          <div className="brand-feature">
            <span>✓</span> Transparent project tracking
          </div>
        </div>

        <p className="brand-bottom">
          PROJECTFLOW · INTERNAL WORKSPACE
        </p>
      </section>

      <section className="login-side">
        <div className="login-card">

          <div className="mobile-brand">
            PROJECTFLOW
          </div>

          <span className="welcome-tag">
            WELCOME BACK
          </span>

          <h2>Sign in to your account</h2>

          <p className="login-description">
            Enter your details to access your workspace.
          </p>

          <form onSubmit={handleSubmit}>

            <label>Email Address</label>
            <input
              type="email"
              name="email"
              placeholder="name@company.com"
              required
            />

            <label>Password</label>
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              required
            />

            <label>Login As</label>

            <select
              name="role"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select your role
              </option>

              <option value="employee">
                Employee
              </option>

              <option value="manager">
                Manager
              </option>
            </select>

            <button type="submit">
              Sign In to Workspace →
            </button>

          </form>

          <div className="login-security">
            <span>🔒</span>
            Internal Company Portal
          </div>

        </div>
      </section>

    </div>
  );
}

export default Login;
