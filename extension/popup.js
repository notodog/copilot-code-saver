// ============ CONSTANTS ============

const HOST_NAME = 'com.ccs.host';

// ============ DOM ELEMENTS ============

const elements = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  projectList: document.getElementById('project-list'),
  projectForm: document.getElementById('project-form'),
  formTitle: document.getElementById('form-title'),
  editId: document.getElementById('edit-id'),
  projectName: document.getElementById('project-name'),
  projectRoot: document.getElementById('project-root'),
  addBtn: document.getElementById('add-project'),
  saveBtn: document.getElementById('form-save'),
  cancelBtn: document.getElementById('form-cancel'),
  exportBtn: document.getElementById('export-config'),
  importBtn: document.getElementById('import-config'),
};

// ============ NATIVE HOST CHECK ============

async function checkNativeHost() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { target: 'background', message: { action: 'ping' } },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ connected: false, error: chrome.runtime.lastError.message });
          } else if (response?.success) {
            resolve({ connected: true });
          } else {
            resolve({ connected: false, error: response?.error || 'Unknown error' });
          }
        }
      );
    } catch (e) {
      resolve({ connected: false, error: e.message });
    }
  });
}

async function updateStatus() {
  const result = await checkNativeHost();
  
  if (result.connected) {
    elements.status.className = 'status connected';
    elements.statusText.textContent = 'Native host connected';
  } else {
    elements.status.className = 'status disconnected';
    elements.statusText.textContent = `Not connected: ${result.error}`;
  }
}

// ============ PROJECT STORAGE ============

async function getProjects() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['projects', 'defaultProject'], (data) => {
      resolve({
        projects: data.projects || [],
        defaultProject: data.defaultProject || null
      });
    });
  });
}

async function saveProjects(projects, defaultProject) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ projects, defaultProject }, resolve);
  });
}

// ============ PROJECT RENDERING ============

function createProjectElement(project, isDefault) {
  const div = document.createElement('div');
  div.className = `project-item${isDefault ? ' is-default' : ''}`;
  div.dataset.id = project.id;
  
  div.innerHTML = `
    <div class="project-info">
      <div class="project-name">
        ${escapeHtml(project.name)}
        ${isDefault ? '<span class="default-badge">Default</span>' : ''}
      </div>
      <div class="project-path">${escapeHtml(project.root)}</div>
    </div>
    <div class="project-actions">
      ${!isDefault ? `<button class="set-default" title="Set as default">⭐</button>` : ''}
      <button class="edit" title="Edit">✏️</button>
      <button class="delete" title="Delete">🗑️</button>
    </div>
  `;
  
  // Set as default
  const setDefaultBtn = div.querySelector('.set-default');
  if (setDefaultBtn) {
    setDefaultBtn.addEventListener('click', () => setDefaultProject(project.id));
  }
  
  // Edit
  div.querySelector('.edit').addEventListener('click', () => editProject(project));
  
  // Delete
  div.querySelector('.delete').addEventListener('click', () => deleteProject(project.id));
  
  return div;
}

async function renderProjects() {
  const { projects, defaultProject } = await getProjects();
  
  elements.projectList.innerHTML = '';
  
  if (projects.length === 0) {
    elements.projectList.innerHTML = '<div class="empty-state">No projects configured yet.</div>';
    return;
  }
  
  // Sort: default first, then alphabetically
  const sorted = [...projects].sort((a, b) => {
    if (a.id === defaultProject) return -1;
    if (b.id === defaultProject) return 1;
    return a.name.localeCompare(b.name);
  });
  
  sorted.forEach(project => {
    const isDefault = project.id === defaultProject;
    elements.projectList.appendChild(createProjectElement(project, isDefault));
  });
}

// ============ PROJECT CRUD ============

function generateId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36);
}

function showForm(title = 'Add Project', project = null) {
  elements.formTitle.textContent = title;
  elements.editId.value = project?.id || '';
  elements.projectName.value = project?.name || '';
  elements.projectRoot.value = project?.root || '';
  elements.projectForm.classList.add('visible');
  elements.projectName.focus();
}

function hideForm() {
  elements.projectForm.classList.remove('visible');
  elements.editId.value = '';
  elements.projectName.value = '';
  elements.projectRoot.value = '';
}

async function saveProject() {
  const name = elements.projectName.value.trim();
  const root = elements.projectRoot.value.trim();
  const editId = elements.editId.value;
  
  // Validation
  if (!name) {
    alert('Please enter a project name');
    elements.projectName.focus();
    return;
  }
  
  if (!root) {
    alert('Please enter a root path');
    elements.projectRoot.focus();
    return;
  }
  
  if (!root.startsWith('/')) {
    alert('Root path must be absolute (start with /)');
    elements.projectRoot.focus();
    return;
  }
  
  const { projects, defaultProject } = await getProjects();
  
  if (editId) {
    // Update existing
    const index = projects.findIndex(p => p.id === editId);
    if (index !== -1) {
      projects[index] = { ...projects[index], name, root };
    }
  } else {
    // Add new
    const id = generateId(name);
    projects.push({ id, name, root });
    
    // If first project, set as default
    if (projects.length === 1) {
      await saveProjects(projects, id);
      hideForm();
      renderProjects();
      return;
    }
  }
  
  await saveProjects(projects, defaultProject);
  hideForm();
  renderProjects();
}

function editProject(project) {
  showForm('Edit Project', project);
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  
  let { projects, defaultProject } = await getProjects();
  
  projects = projects.filter(p => p.id !== id);
  
  // If deleted project was default, clear default or set first
  if (defaultProject === id) {
    defaultProject = projects.length > 0 ? projects[0].id : null;
  }
  
  await saveProjects(projects, defaultProject);
  renderProjects();
}

async function setDefaultProject(id) {
  const { projects } = await getProjects();
  await saveProjects(projects, id);
  renderProjects();
}

// ============ IMPORT / EXPORT ============

async function exportConfig() {
  const { projects, defaultProject } = await getProjects();
  
  const config = {
    version: '0.4.0',
    defaultProject,
    projects
  };
  
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'copilot-code-saver-config.json';
  a.click();
  
  URL.revokeObjectURL(url);
}

async function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const config = JSON.parse(text);
      
      // Validate
      if (!Array.isArray(config.projects)) {
        throw new Error('Invalid config: missing projects array');
      }
      
      for (const p of config.projects) {
        if (!p.id || !p.name || !p.root) {
          throw new Error('Invalid config: project missing id, name, or root');
        }
      }
      
      // Confirm
      const count = config.projects.length;
      if (!confirm(`Import ${count} project(s)? This will replace your current configuration.`)) {
        return;
      }
      
      // Save
      await saveProjects(config.projects, config.defaultProject || config.projects[0]?.id);
      renderProjects();
      alert('Configuration imported successfully!');
      
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });
  
  input.click();
}

// ============ UTILITIES ============

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ EVENT LISTENERS ============

elements.addBtn.addEventListener('click', () => showForm('Add Project'));
elements.cancelBtn.addEventListener('click', hideForm);
elements.saveBtn.addEventListener('click', saveProject);
elements.exportBtn.addEventListener('click', (e) => {
  e.preventDefault();
  exportConfig();
});
elements.importBtn.addEventListener('click', (e) => {
  e.preventDefault();
  importConfig();
});

// Form keyboard shortcuts
elements.projectForm.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideForm();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    saveProject();
  }
});

// ============ INIT ============

updateStatus();
renderProjects();
