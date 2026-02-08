(() => {
  const PROCESSED_ATTR = 'data-ccs-processed';

  const ICONS = {
    save: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
  };

  // ============ NATIVE MESSAGING (via background) ============

  function sendNativeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { target: 'background', message: message },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!response) {
            reject(new Error('No response from background script'));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  // ============ PROJECT MANAGEMENT (chrome.storage) ============

  async function listProjects() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['projects', 'defaultProject'], (data) => {
        const projects = data.projects || [];
        if (projects.length === 0) {
          resolve({
            projects: [],
            default: null,
            error: 'No projects configured. Click the extension icon to add projects.'
          });
        } else {
          resolve({
            projects: projects,
            default: data.defaultProject || projects[0]?.id || null
          });
        }
      });
    });
  }

  // ============ RECENT PATHS MEMORY ============

  async function getRecentPaths(projectId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['recentPaths'], (data) => {
        const all = data.recentPaths || {};
        resolve(all[projectId] || []);
      });
    });
  }

  async function saveRecentPath(projectId, filePath) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['recentPaths'], (data) => {
        const all = data.recentPaths || {};
        const paths = all[projectId] || [];
        
        // Extract directory
        const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
        
        // Add to front, remove duplicates, keep last 10
        const updated = [filePath, ...paths.filter(p => p !== filePath)].slice(0, 10);
        all[projectId] = updated;
        
        chrome.storage.local.set({ recentPaths: all }, resolve);
      });
    });
  }

  async function getLastDirectory(projectId) {
    const paths = await getRecentPaths(projectId);
    if (paths.length > 0) {
      const lastPath = paths[0];
      const lastSlash = lastPath.lastIndexOf('/');
      return lastSlash > 0 ? lastPath.substring(0, lastSlash + 1) : '';
    }
    return '';
  }

  // ============ FILE OPERATIONS ============

  async function saveFile(absolutePath, content) {
    try {
      const response = await sendNativeMessage({
        action: 'save',
        path: absolutePath,
        content: content
      });
      return response;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============ SMART FILENAME DETECTION ============

  const FilenameDetector = {
    /**
     * Main detection entry point - tries multiple strategies in priority order
     */
    detect(preElement, codeContent, languageExt) {
      const codeBlock = preElement.querySelector('code') || preElement;
      const surroundingText = this.getSurroundingText(preElement);
      
      // Try detection methods in priority order
      return this.fromCodeBlockHeader(preElement)
          || this.fromConversationContext(surroundingText)
          || this.fromFirstLineComment(codeContent)
          || this.fromCodeStructure(codeContent, languageExt)
          || this.fromMarkdownContext(preElement)
          || this.generateSmartDefault(codeContent, languageExt);
    },

    /**
     * Get surrounding text from conversation (extended range)
     */
    getSurroundingText(preElement) {
      const texts = [];
      
      // Check previous siblings (up to 5)
      let sibling = preElement.previousElementSibling;
      for (let i = 0; i < 5 && sibling; i++) {
        texts.push(sibling.textContent || '');
        sibling = sibling.previousElementSibling;
      }
      
      // Check parent's previous siblings
      const parent = preElement.parentElement;
      if (parent) {
        let parentSibling = parent.previousElementSibling;
        for (let i = 0; i < 3 && parentSibling; i++) {
          texts.push(parentSibling.textContent || '');
          parentSibling = parentSibling.previousElementSibling;
        }
      }
      
      // Check grandparent (for deeply nested code blocks)
      const grandparent = parent?.parentElement;
      if (grandparent) {
        let gpSibling = grandparent.previousElementSibling;
        for (let i = 0; i < 2 && gpSibling; i++) {
          texts.push(gpSibling.textContent || '');
          gpSibling = gpSibling.previousElementSibling;
        }
      }
      
      return texts.join(' ').substring(0, 3000);
    },

    /**
     * Strategy 1: Parse code block header/label (AI chat specific)
     */
    fromCodeBlockHeader(preElement) {
      // Check for header element above code block
      const header = preElement.previousElementSibling;
      if (header) {
        const headerText = header.textContent?.trim() || '';
        
        // Pattern: "filename.ext" or "path/to/filename.ext"
        const match = headerText.match(/^([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)$/);
        if (match) {
          return { filename: match[1], source: 'header', confidence: 'high' };
        }
      }
      
      // Check for data attributes on code block
      const codeEl = preElement.querySelector('code');
      if (codeEl) {
        const dataFile = codeEl.getAttribute('data-file') 
                      || codeEl.getAttribute('data-filename')
                      || preElement.getAttribute('data-file');
        if (dataFile) {
          return { filename: dataFile, source: 'data-attr', confidence: 'high' };
        }
      }
      
      // Check for title attribute
      const title = preElement.getAttribute('title') || codeEl?.getAttribute('title');
      if (title && /\.[a-z0-9]+$/i.test(title)) {
        return { filename: title, source: 'title-attr', confidence: 'high' };
      }
      
      return null;
    },

    /**
     * Strategy 2: Parse conversation context for filename mentions
     */
    fromConversationContext(text) {
      const patterns = [
        // Explicit file references
        { re: /(?:save|create|write)\s+(?:this\s+)?(?:as|to|in)\s+[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'high' },
        { re: /(?:file|filename|name)[:\s]+[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'high' },
        { re: /(?:called|named)\s+[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'high' },
        
        // Update/modify references
        { re: /(?:update|modify|edit|change)\s+(?:your\s+)?[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'high' },
        
        // "Here's the X" pattern
        { re: /(?:here'?s?|this is)\s+(?:the\s+)?(?:updated?\s+)?[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'medium' },
        
        // Backtick/quote wrapped filenames
        { re: /[`'"]([a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]/i, conf: 'medium' }, // with path
        { re: /[`'"]([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)[`'"]/i, conf: 'low' }, // just filename
        
        // "in src/..." pattern
        { re: /\bin\s+[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?/i, conf: 'medium' },
        
        // Markdown header with filename
        { re: /^#+\s*[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?\s*$/m, conf: 'high' },
      ];
      
      for (const { re, conf } of patterns) {
        const match = text.match(re);
        if (match && match[1]) {
          // Validate it looks like a real filename
          const filename = match[1];
          if (this.isValidFilename(filename)) {
            return { filename, source: 'context', confidence: conf };
          }
        }
      }
      
      return null;
    },

    /**
     * Strategy 3: Parse first line comment for filename hint
     */
    fromFirstLineComment(code) {
      const lines = code.trim().split('\n').slice(0, 3); // Check first 3 lines
      
      const patterns = [
        // // filename.ext or // file: filename.ext
        /^\/\/\s*(?:file(?:name)?[:\s]+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
        // # filename.ext or # file: filename.ext  
        /^#\s*(?:file(?:name)?[:\s]+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
        // /* filename.ext */ or /** @file filename.ext */
        /^\/\*+\s*(?:@file\s+)?(?:file(?:name)?[:\s]+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
        // <!-- filename.ext -->
        /^<!--\s*(?:file(?:name)?[:\s]+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
        // -- filename.ext (SQL)
        /^--\s*(?:file(?:name)?[:\s]+)?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i,
      ];
      
      for (const line of lines) {
        for (const pattern of patterns) {
          const match = line.match(pattern);
          if (match && match[1] && this.isValidFilename(match[1])) {
            return { filename: match[1], source: 'comment', confidence: 'high' };
          }
        }
      }
      
      return null;
    },

    /**
     * Strategy 4: Infer from code structure
     */
    fromCodeStructure(code, ext) {
      const rules = [
        // ===== RUST =====
        { test: /^fn\s+main\s*\(/m, ext: 'rs', name: 'main.rs', conf: 'high' },
        { test: /^#\[cfg\(test\)\]/m, ext: 'rs', name: 'lib.rs', conf: 'medium' },
        { test: /^pub\s+mod\s+/m, ext: 'rs', name: 'lib.rs', conf: 'medium' },
        { test: /^mod\s+tests\s*\{/m, ext: 'rs', name: 'lib.rs', conf: 'medium' },
        { 
          test: /^(?:pub\s+)?struct\s+(\w+)/m, 
          ext: 'rs', 
          nameFn: (m) => this.toSnakeCase(m[1]) + '.rs',
          conf: 'low'
        },
        
        // ===== PYTHON =====
        { test: /^if\s+__name__\s*==\s*['"]__main__['"]/m, ext: 'py', name: 'main.py', conf: 'high' },
        { test: /^from\s+flask\s+import/m, ext: 'py', name: 'app.py', conf: 'medium' },
        { test: /^from\s+django/m, ext: 'py', name: 'views.py', conf: 'low' },
        { test: /^import\s+pytest/m, ext: 'py', name: 'test_main.py', conf: 'medium' },
        { test: /^def\s+test_/m, ext: 'py', name: 'test_main.py', conf: 'medium' },
        {
          test: /^class\s+(\w+)(?:\(.*\))?:/m,
          ext: 'py',
          nameFn: (m) => this.toSnakeCase(m[1]) + '.py',
          conf: 'low'
        },
        
        // ===== JAVASCRIPT/TYPESCRIPT =====
        { test: /^['"]use client['"]/m, ext: 'jsx', name: 'page.tsx', conf: 'medium' },
        { test: /^['"]use server['"]/m, ext: 'js', name: 'actions.ts', conf: 'medium' },
        { 
          test: /^(?:export\s+)?(?:default\s+)?function\s+(\w+)/m,
          extMatch: /^[jt]sx?$/,
          nameFn: (m, ext) => {
            const name = m[1];
            // React component (PascalCase)
            if (/^[A-Z]/.test(name)) {
              return `${name}.${ext === 'ts' ? 'tsx' : 'jsx'}`;
            }
            return null; // Let other rules handle it
          },
          conf: 'medium'
        },
        {
          test: /^export\s+default\s+function\s+(\w+)/m,
          ext: 'js',
          nameFn: (m) => `${m[1]}.js`,
          conf: 'low'
        },
        
        // ===== GO =====
        { test: /^package\s+main\b/m, ext: 'go', name: 'main.go', conf: 'high' },
        { test: /^func\s+Test\w+\s*\(/m, ext: 'go', name: 'main_test.go', conf: 'medium' },
        
        // ===== CONFIG FILES =====
        { test: /^\[package\]\s*$/m, ext: 'toml', name: 'Cargo.toml', conf: 'high' },
        { test: /^\[dependencies\]/m, ext: 'toml', name: 'Cargo.toml', conf: 'medium' },
        { test: /^\[tool\.poetry\]/m, ext: 'toml', name: 'pyproject.toml', conf: 'high' },
        { test: /^\[build-system\]/m, ext: 'toml', name: 'pyproject.toml', conf: 'medium' },
        { test: /^{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"/m, ext: 'json', name: 'package.json', conf: 'high' },
        { test: /^{\s*"compilerOptions"/m, ext: 'json', name: 'tsconfig.json', conf: 'high' },
        { test: /"manifest_version"\s*:\s*\d/m, ext: 'json', name: 'manifest.json', conf: 'high' },
        { test: /^{\s*"scripts"\s*:/m, ext: 'json', name: 'package.json', conf: 'medium' },
        { test: /^version:\s*['"]?\d/m, ext: 'yaml', name: 'docker-compose.yml', conf: 'low' },
        { test: /^services:\s*$/m, ext: 'yaml', name: 'docker-compose.yml', conf: 'medium' },
        { test: /^FROM\s+\w+/m, name: 'Dockerfile', conf: 'high' },
        { test: /^apiVersion:\s*apps\/v1/m, ext: 'yaml', name: 'deployment.yaml', conf: 'medium' },
        
        // ===== MARKUP =====
        { test: /^<!DOCTYPE html>/i, ext: 'html', name: 'index.html', conf: 'medium' },
        { test: /^<html/i, ext: 'html', name: 'index.html', conf: 'low' },
        
        // ===== SHELL =====
        { test: /^#!\/usr\/bin\/env\s+bash/m, ext: 'sh', name: 'script.sh', conf: 'medium' },
        { test: /^#!\/bin\/bash/m, ext: 'sh', name: 'script.sh', conf: 'medium' },
        { test: /^#!\/usr\/bin\/env\s+sh/m, ext: 'sh', name: 'script.sh', conf: 'medium' },
        { test: /^#!\/usr\/bin\/env\s+zsh/m, ext: 'sh', name: 'script.zsh', conf: 'medium' },
        
        // ===== CSS =====
        { test: /^:root\s*{/m, ext: 'css', name: 'styles.css', conf: 'low' },
        { test: /^@tailwind/m, ext: 'css', name: 'globals.css', conf: 'medium' },
        
        // ===== SQL =====
        { test: /^CREATE\s+TABLE/im, ext: 'sql', name: 'schema.sql', conf: 'medium' },
        { test: /^CREATE\s+DATABASE/im, ext: 'sql', name: 'init.sql', conf: 'medium' },
        { test: /^INSERT\s+INTO/im, ext: 'sql', name: 'seed.sql', conf: 'low' },
      ];
      
      for (const rule of rules) {
        // Check if extension matches (if specified)
        if (rule.ext && ext !== rule.ext) continue;
        if (rule.extMatch && !rule.extMatch.test(ext)) continue;
        
        const match = code.match(rule.test);
        if (match) {
          let filename;
          if (rule.nameFn) {
            filename = rule.nameFn(match, ext);
            if (!filename) continue; // nameFn returned null, skip this rule
          } else {
            filename = rule.name;
          }
          return { filename, source: 'code-structure', confidence: rule.conf };
        }
      }
      
      return null;
    },

    /**
     * Strategy 5: Check markdown formatting around code block
     */
    fromMarkdownContext(preElement) {
      // Look for markdown headers or bold text with filenames
      let el = preElement.previousElementSibling;
      for (let i = 0; i < 3 && el; i++) {
        const text = el.textContent?.trim() || '';
        
        // Check for "### filename.ext" or "**filename.ext**"
        const patterns = [
          /^#+\s*[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?\s*$/,
          /^\*\*[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?\*\*$/,
          /^File:\s*[`'"]?([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)[`'"]?$/i,
        ];
        
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match && match[1] && this.isValidFilename(match[1])) {
            return { filename: match[1], source: 'markdown', confidence: 'high' };
          }
        }
        
        el = el.previousElementSibling;
      }
      
      return null;
    },

    /**
     * Strategy 6: Generate smart default (last resort)
     */
    generateSmartDefault(code, ext) {
      // Try to extract a meaningful name from the code
      const extractors = [
        // Function name
        { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, suffix: ext },
        // Class name
        { re: /^(?:export\s+)?class\s+(\w+)/m, suffix: ext },
        // Const/let component
        { re: /^(?:export\s+)?const\s+(\w+)\s*=/m, suffix: ext },
        // Rust struct/enum
        { re: /^(?:pub\s+)?(?:struct|enum)\s+(\w+)/m, suffix: 'rs' },
      ];
      
      for (const { re, suffix } of extractors) {
        const match = code.match(re);
        if (match && match[1]) {
          const name = this.toSnakeCase(match[1]);
          return { filename: `${name}.${suffix || ext}`, source: 'extracted', confidence: 'low' };
        }
      }
      
      // Final fallback with timestamp
      return { 
        filename: `snippet-${Date.now().toString(36)}.${ext}`, 
        source: 'generated', 
        confidence: 'none' 
      };
    },

    // ===== HELPERS =====

    toSnakeCase(str) {
      return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/__+/g, '_');
    },

    isValidFilename(name) {
      // Basic validation
      if (!name || name.length > 255) return false;
      if (name.startsWith('.') && name.split('.').length < 3) return false; // Just ".ext"
      if (/^[0-9]/.test(name)) return false; // Starts with number (unlikely filename)
      if (!/\.[a-z0-9]{1,10}$/i.test(name)) return false; // Must have extension
      if (/[<>:"|?*]/.test(name)) return false; // Invalid characters
      return true;
    }
  };

  // ============ LANGUAGE DETECTION ============

  function detectLanguage(codeBlock) {
    const classes = (codeBlock.className || '') + ' ' + (codeBlock.closest('pre')?.className || '');
    const langMap = [
      [/\b(rust)\b/i, 'rs'],
      [/\b(javascript|js)\b/i, 'js'],
      [/\b(typescript|ts)\b/i, 'ts'],
      [/\b(python|py)\b/i, 'py'],
      [/\b(bash|shell|sh)\b/i, 'sh'],
      [/\b(json)\b/i, 'json'],
      [/\b(yaml|yml)\b/i, 'yaml'],
      [/\b(toml)\b/i, 'toml'],
      [/\b(sql)\b/i, 'sql'],
      [/\b(html)\b/i, 'html'],
      [/\b(css)\b/i, 'css'],
      [/\b(markdown|md)\b/i, 'md'],
      [/\b(go|golang)\b/i, 'go'],
      [/\b(java)\b/i, 'java'],
      [/\b(c|cpp|c\+\+)\b/i, 'cpp'],
      [/\b(ruby|rb)\b/i, 'rb'],
      [/\b(php)\b/i, 'php'],
      [/\b(swift)\b/i, 'swift'],
      [/\b(kotlin|kt)\b/i, 'kt'],
      [/\b(dockerfile)\b/i, 'dockerfile'],
    ];
    for (const [pattern, ext] of langMap) {
      if (pattern.test(classes)) return ext;
    }
    return 'txt';
  }

  // ============ PATH UTILITIES ============

  function joinPath(root, relativePath) {
    const cleanRelative = relativePath.replace(/^\/+/, '');
    const cleanRoot = root.replace(/\/+$/, '');
    return `${cleanRoot}/${cleanRelative}`;
  }

  // ============ MODAL ============

  async function showSaveModal(code, detectedInfo, onSave, onCancel) {
    const { projects, default: defaultProject, error } = await listProjects();

    if (error || projects.length === 0) {
      alert(`Copilot Code Saver: ${error || 'No projects configured'}\n\nClick the extension icon to add projects.`);
      onCancel();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ccs-modal-overlay';

    chrome.storage.sync.get(['lastProject'], async (stored) => {
      const selectedProjectId = stored.lastProject || defaultProject || projects[0]?.id;
      
      // Get last used directory for this project
      const lastDir = await getLastDirectory(selectedProjectId);
      
      // Determine default filename
      let defaultFilename = detectedInfo.filename || `snippet-${Date.now().toString(36)}.${detectedInfo.ext}`;
      
      // If filename doesn't include path and we have a last directory, prepend it
      if (lastDir && !defaultFilename.includes('/')) {
        defaultFilename = lastDir + defaultFilename;
      }

      const projectOptions = projects.map(p =>
        `<option value="${p.id}" ${p.id === selectedProjectId ? 'selected' : ''}>${p.name}</option>`
      ).join('');

      const selectedProjectData = projects.find(p => p.id === selectedProjectId);
      
      // Show confidence indicator
      const confidenceBadge = detectedInfo.confidence && detectedInfo.confidence !== 'none'
        ? `<span class="ccs-confidence ccs-confidence-${detectedInfo.confidence}">${detectedInfo.confidence}</span>`
        : '';

      overlay.innerHTML = `
        <div class="ccs-modal">
          <h3>💾 Save to Project</h3>
          
          ${detectedInfo.filename ? `
            <div class="ccs-detected">
              ✨ Detected from ${detectedInfo.source}: <strong>${detectedInfo.filename}</strong>
              ${confidenceBadge}
            </div>
          ` : ''}
          
          <label>Project</label>
          <select id="ccs-project">${projectOptions}</select>
          
          <label>Path (relative to project root)</label>
          <input type="text" id="ccs-path" value="${defaultFilename}" placeholder="src/utils.rs">
          
          <label>Full Path Preview</label>
          <div class="ccs-preview" id="ccs-preview">
            ${joinPath(selectedProjectData?.root || '', defaultFilename)}
          </div>
          
          <div class="ccs-modal-buttons">
            <button class="ccs-modal-btn secondary" id="ccs-cancel">Cancel</button>
            <button class="ccs-modal-btn primary" id="ccs-save">Save</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const projectSelect = overlay.querySelector('#ccs-project');
      const pathInput = overlay.querySelector('#ccs-path');
      const preview = overlay.querySelector('#ccs-preview');

      function updatePreview() {
        const proj = projects.find(p => p.id === projectSelect.value);
        const relativePath = pathInput.value.replace(/^\/+/, '');
        preview.textContent = joinPath(proj?.root || '', relativePath);
      }

      // Update last directory when project changes
      projectSelect.addEventListener('change', async () => {
        const newProjectId = projectSelect.value;
        const newLastDir = await getLastDirectory(newProjectId);
        
        // If current path is just a filename, prepend new project's last dir
        const currentPath = pathInput.value;
        if (newLastDir && !currentPath.includes('/')) {
          pathInput.value = newLastDir + currentPath;
        }
        
        updatePreview();
      });
      
      pathInput.addEventListener('input', updatePreview);
      pathInput.focus();
      pathInput.select();

      overlay.querySelector('#ccs-cancel').addEventListener('click', () => {
        overlay.remove();
        onCancel();
      });

      overlay.querySelector('#ccs-save').addEventListener('click', async () => {
        const projectId = projectSelect.value;
        const project = projects.find(p => p.id === projectId);
        const relativePath = pathInput.value.trim().replace(/^\/+/, '');
        
        if (!project) {
          alert('Please select a project');
          return;
        }
        
        if (!relativePath) {
          alert('Please enter a file path');
          return;
        }

        const absolutePath = joinPath(project.root, relativePath);
        
        // Save to recent paths
        await saveRecentPath(projectId, relativePath);
        
        chrome.storage.sync.set({ lastProject: projectId });
        
        overlay.remove();
        onSave(absolutePath);
      });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          onCancel();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          overlay.querySelector('#ccs-save').click();
        }
      });
    });
  }

  // ============ BUTTON INJECTION ============

  function injectButton(preElement, index) {
    if (preElement.hasAttribute(PROCESSED_ATTR)) return;
    preElement.setAttribute(PROCESSED_ATTR, 'true');

    const codeEl = preElement.querySelector('code') || preElement;
    const code = codeEl.textContent || '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; display: inline-block; width: 100%;';
    preElement.parentNode.insertBefore(wrapper, preElement);
    wrapper.appendChild(preElement);

    const btn = document.createElement('button');
    btn.innerHTML = ICONS.save;
    btn.title = 'Save to project';
    btn.style.cssText = `
      position: absolute;
      bottom: 10px;
      right: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      margin: 0;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 6px;
      cursor: pointer;
      color: #444;
      transition: all 0.15s ease;
      box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      z-index: 10000;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#0078d4';
      btn.style.color = 'white';
      btn.style.borderColor = '#0078d4';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.95)';
      btn.style.color = '#444';
      btn.style.borderColor = 'rgba(0, 0, 0, 0.15)';
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const ext = detectLanguage(codeEl);
      
      // Use smart detection
      const detected = FilenameDetector.detect(preElement, code, ext);

      const detectedInfo = {
        filename: detected.filename,
        source: detected.source,
        confidence: detected.confidence,
        ext: ext
      };

      showSaveModal(code, detectedInfo,
        async (absolutePath) => {
          const result = await saveFile(absolutePath, code);
          if (result.success) {
            btn.innerHTML = ICONS.check;
            btn.title = `Saved to ${result.full_path}`;
          } else {
            btn.innerHTML = ICONS.error;
            btn.title = `Error: ${result.error}`;
            alert(`Save failed: ${result.error}`);
          }
          setTimeout(() => {
            btn.innerHTML = ICONS.save;
            btn.title = 'Save to project';
          }, 2000);
        },
        () => {}
      );
    });

    wrapper.appendChild(btn);
  }

  function processCodeBlocks() {
    document.querySelectorAll('pre').forEach((pre, index) => {
      injectButton(pre, index);
    });
  }

  const observer = new MutationObserver(() => processCodeBlocks());
  processCodeBlocks();
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[Copilot Code Saver] Loaded v0.4.0');
})();
