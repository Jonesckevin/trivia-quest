// ==================== QUIZ MODE ====================
// Handles: mode detection, user registration, quiz flow, admin panel, results/charts

(function () {
    'use strict';

    // ==================== QUIZ STATE ====================
    const quizState = {
        config: null,           // { freeplay, requireUserPassword, appTitle }
        user: null,             // { id, username }
        userToken: null,        // JWT for authenticated user API calls
        adminToken: null,
        activeSession: null,    // session object with questions
        quizQuestions: [],       // ordered questions for current quiz
        currentIndex: 0,
        answeredCount: 0,
        correctCount: 0,
        questionStartTime: null,
        sessionStartTime: null,
        answeredIds: new Set(),
        editingSessionId: null,
        submitting: false,      // debounce guard for answer submission
        pendingHidden: null,    // deferred hidden question awaiting Next click
        charts: {},             // chart.js instances
        currentScreen: null,    // 'auth' | 'quiz' | 'quizComplete' | 'freeplay' | 'admin'
        apiAvailable: false,
    };

    // ==================== HELPERS ====================
    function $(id) { return document.getElementById(id); }
    function show(el) { if (el) el.classList.remove('hidden'); }
    function hide(el) { if (el) el.classList.add('hidden'); }

    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
        if (quizState.adminToken) headers['X-Admin-Token'] = quizState.adminToken;
        if (quizState.userToken) headers['Authorization'] = `Bearer ${quizState.userToken}`;
        const resp = await fetch(`/api${path}`, { ...options, headers });
        if (path.includes('/export') && resp.ok) return resp;
        return resp.json();
    }

    function showToast(message, type = 'success') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => { toast.classList.add('toast-fade'); }, 2500);
        setTimeout(() => { toast.remove(); }, 3000);
    }

    function updateFreeplayButton(freeplay) {
        const cb = $('freeplayToggleInput');
        if (cb) cb.checked = !!freeplay;
    }

    // ==================== INITIALIZATION ====================
    // Swap every logo <img> to url and update the admin preview thumb
    function applyCustomLogo(url) {
        document.querySelectorAll('img[src$="logo.svg"], img[src^="/api/logo"]').forEach(img => { img.src = url; });
        const preview = $('adminLogoPreview');
        if (preview) preview.src = url;
    }

    async function initQuizMode() {
        try {
            const data = await api('/config');
            // Mark API as reachable regardless of success flag
            quizState.apiAvailable = true;
            if (data?.success) {
                quizState.config = data.config;
            } else {
                // API is up but returned an error — use safe defaults so auth screen still renders
                quizState.config = { freeplay: false, requireUserPassword: true, appTitle: 'Trivia Quest' };
            }

            // Restore admin token from sessionStorage
            const savedToken = sessionStorage.getItem('tq_admin_token');
            if (savedToken) quizState.adminToken = savedToken;

            // Restore user JWT — localStorage (remember me) takes priority over sessionStorage
            const savedUserToken = localStorage.getItem('tq_user_token') || sessionStorage.getItem('tq_user_token');
            if (savedUserToken) quizState.userToken = savedUserToken;

            const savedUserStr = localStorage.getItem('tq_user') || sessionStorage.getItem('tq_user');
            if (savedUserStr) quizState.user = JSON.parse(savedUserStr);

            showQuizMode();

            // Load custom logo if one has been uploaded
            fetch('/api/logo', { method: 'HEAD' }).then(r => {
                if (r.ok) applyCustomLogo(`/api/logo?v=${Date.now()}`);
            }).catch(() => {});
        } catch (e) {
            // API completely unreachable (nginx down, non-JSON error page, network failure)
            console.warn('Quiz mode init: API unavailable, defaulting to freeplay', e);
            showFreeplayMode();
        }
    }

    function showFreeplayMode() {
        hideAllScreens();
        quizState.currentScreen = 'freeplay';
        show($('sidebarToggle'));
        show($('sidebar'));
        show($('welcomeScreen'));
        updateNav();
    }

    function showQuizMode() {
        // If admin is logged in, show admin panel
        if (quizState.adminToken) {
            showAdminPanel();
            return;
        }

        // If user is logged in and session is active, resume quiz
        if (quizState.user) {
            loadAndStartQuiz();
            return;
        }

        // Show auth screen
        showAuthScreen();
    }

    // ==================== AUTH SCREEN ====================
    function showAuthScreen() {
        hideAllScreens();
        quizState.currentScreen = 'auth';
        show($('quizAuthScreen'));
        hide($('authError'));
        loadActiveSessionInfo();
        if (quizState.config?.requireUserPassword) {
            show($('regPasswordGroup'));
            show($('loginPasswordGroup'));
        } else {
            hide($('regPasswordGroup'));
            hide($('loginPasswordGroup'));
        }
        // Guest/freeplay shortcut only available when freeplay is on
        if (quizState.config?.freeplay) show($('authGuestSection'));
        else hide($('authGuestSection'));
        updateNav();
    }

    async function loadActiveSessionInfo() {
        const el = $('authIntroText');
        try {
            const data = await api('/session/active');
            if (!el) return;
            el.textContent = (data.success && data.session)
                ? (data.session.name || 'Quiz Available')
                : 'No active quiz. Please wait for the admin to start one.';
        } catch {
            if (el) el.textContent = 'Sign in to participate in the quiz.';
        }
    }

    function initAuthListeners() {
        // Prevent form submission (buttons trigger via click handlers)
        $('registerForm')?.addEventListener('submit', e => e.preventDefault());
        $('loginForm')?.addEventListener('submit', e => e.preventDefault());

        // Tab switching
        $('authRegisterTab')?.addEventListener('click', () => {
            $('authRegisterTab').classList.add('active');
            $('authLoginTab').classList.remove('active');
            show($('registerForm'));
            hide($('loginForm'));
        });
        $('authLoginTab')?.addEventListener('click', () => {
            $('authLoginTab').classList.add('active');
            $('authRegisterTab').classList.remove('active');
            hide($('registerForm'));
            show($('loginForm'));
        });

        // Register
        $('registerBtn')?.addEventListener('click', async () => {
            const username = $('regUsername').value.trim();
            if (!username) return showError('authError', 'Please enter a username');

            const body = { username };
            if (quizState.config?.requireUserPassword) {
                const pw = $('regPassword').value;
                if (!pw || pw.length < 4) return showError('authError', 'Password must be at least 4 characters');
                body.password = pw;
            }

            try {
                const data = await api('/register', { method: 'POST', body: JSON.stringify(body) });
                if (data.success) {
                    quizState.user = data.user;
                    quizState.userToken = data.token || null;
                    sessionStorage.setItem('tq_user', JSON.stringify(data.user));
                    if (data.token) sessionStorage.setItem('tq_user_token', data.token);
                    updateNav();
                    loadAndStartQuiz();
                } else {
                    showError('authError', data.error);
                }
            } catch (e) {
                showError('authError', 'Connection error');
            }
        });

        // Login
        $('loginBtn')?.addEventListener('click', async () => {
            const username = $('loginUsername').value.trim();
            if (!username) return showError('authError', 'Please enter your username');

            const body = { username };
            if (quizState.config?.requireUserPassword) {
                body.password = $('loginPassword').value;
            }

            try {
                const data = await api('/login', { method: 'POST', body: JSON.stringify(body) });
                if (data.success) {
                    quizState.user = data.user;
                    quizState.userToken = data.token || null;
                    // Honour "remember me" — persist to localStorage so session survives tab close
                    const store = $('loginRemember')?.checked ? localStorage : sessionStorage;
                    store.setItem('tq_user', JSON.stringify(data.user));
                    if (data.token) store.setItem('tq_user_token', data.token);
                    updateNav();
                    loadAndStartQuiz();
                } else {
                    showError('authError', data.error);
                }
            } catch (e) {
                showError('authError', 'Connection error');
            }
        });

        // Guest / freeplay shortcut
        $('authGuestBtn')?.addEventListener('click', () => showFreeplayMode());

        // Enter key on inputs
        $('regUsername')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
        $('loginUsername')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
        $('regPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('registerBtn').click(); });
        $('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

        // Admin login modal
        $('adminLoginCancel')?.addEventListener('click', () => hide($('adminLoginModal')));
        $('adminLoginBtn')?.addEventListener('click', adminLogin);
        $('adminPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });

        // Nav bar handlers
        $('navQuiz')?.addEventListener('click', () => {
            if (quizState.user) {
                loadAndStartQuiz();
            } else {
                showAuthScreen();
            }
        });
        $('navFreeplay')?.addEventListener('click', () => showFreeplayMode());
        $('navAdmin')?.addEventListener('click', () => {
            if (quizState.adminToken) {
                showAdminPanel();
            } else {
                show($('adminLoginModal'));
            }
        });
        $('navProfile')?.addEventListener('click', openProfile);

        function signOut() {
            quizState.user = null;
            quizState.userToken = null;
            quizState.adminToken = null;
            sessionStorage.removeItem('tq_user');
            sessionStorage.removeItem('tq_user_token');
            sessionStorage.removeItem('tq_admin_token');
            localStorage.removeItem('tq_user');
            localStorage.removeItem('tq_user_token');
            quizState.answeredIds.clear();
            quizState.answeredCount = 0;
            quizState.correctCount = 0;
            quizState.currentIndex = 0;
            hide($('userProfileModal'));
            showAuthScreen();
        }

        $('navSignOut')?.addEventListener('click', signOut);
        $('profileSignOutBtn')?.addEventListener('click', signOut);

        $('navSignIn')?.addEventListener('click', () => {
            if (quizState.user) {
                openProfile();
            } else {
                showAuthScreen();
            }
        });
    }

    function showError(id, msg) {
        const el = $(id);
        if (el) { el.textContent = msg; show(el); setTimeout(() => hide(el), 4000); }
    }

    // ==================== ADMIN LOGIN ====================
    async function adminLogin() {
        const pw = $('adminPassword').value;
        if (!pw) return showError('adminLoginError', 'Password required');
        try {
            const data = await api('/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
            if (data.success) {
                quizState.adminToken = data.token;
                sessionStorage.setItem('tq_admin_token', data.token);
                hide($('adminLoginModal'));
                $('adminPassword').value = '';
                updateNav();
                showAdminPanel();
            } else {
                showError('adminLoginError', data.error);
            }
        } catch {
            showError('adminLoginError', 'Connection error');
        }
    }

    // ==================== QUIZ PLAY ====================
    async function loadAndStartQuiz() {
        hideAllScreens();
        quizState.currentScreen = 'quiz';
        show($('quizPlayScreen'));
        updateNav();

        try {
            const data = await api('/session/active');
            if (!data.success || !data.session) {
                $('quizQuestionText').textContent = 'No active quiz session. Please wait for the admin to start one.';
                $('quizNextBtn').disabled = true;
                return;
            }

            quizState.activeSession = data.session;
            quizState.quizQuestions = [...data.session.questions];

            if (data.session.randomizeQuestions) {
                shuffleArray(quizState.quizQuestions);
            }

            // Check existing progress
            const progress = await api(`/session/active/progress/${quizState.user.id}`);
            if (progress.success && progress.progress) {
                quizState.answeredIds = new Set(progress.progress.answeredQuestions);
                quizState.answeredCount = progress.progress.totalAnswered;
                quizState.correctCount = progress.progress.correctAnswers;
            }

            // Filter out already answered questions
            quizState.quizQuestions = quizState.quizQuestions.filter(q => !quizState.answeredIds.has(q.id));
            quizState.currentIndex = 0;

            $('quizPlayTitle').textContent = data.session.name;
            quizState.sessionStartTime = Date.now();

            if (quizState.quizQuestions.length === 0) {
                // All questions answered — show results
                completeQuiz();
                return;
            }

            updateQuizProgress();
            showQuizQuestion();
        } catch (e) {
            $('quizQuestionText').textContent = 'Error loading quiz. Please try again.';
            console.error(e);
        }
    }

    function showQuizQuestion() {
        const q = quizState.quizQuestions[quizState.currentIndex];
        if (!q) { completeQuiz(); return; }

        quizState.questionStartTime = Date.now();
        $('quizCategory').textContent = q.Category;
        $('quizDifficulty').textContent = q.Difficulty;
        $('quizQuestionText').textContent = q.Question;
        $('quizNextBtn').disabled = true;
        hide($('quizDescription'));

        const grid = $('quizAnswersGrid');
        grid.innerHTML = '';

        if (q.Type === 'hidden') {
            renderQuizHiddenQuestion(q, grid);
        } else if (q.Type === 'general') {
            renderQuizGeneralQuestion(q, grid);
        } else if (q.Type === 'multiple_answer') {
            renderQuizMultiAnswerQuestion(q, grid);
        } else {
            renderQuizMultipleChoiceQuestion(q, grid);
        }
    }

    function renderQuizMultipleChoiceQuestion(q, grid) {
        const allAnswers = [...q.Answers, ...q.IncorrectAnswers];
        shuffleArray(allAnswers);
        // Limit based on difficulty
        const maxChoices = 6;
        const choices = allAnswers.slice(0, Math.max(maxChoices, q.Answers.length + 1));

        choices.forEach(answer => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.textContent = answer;
            btn.addEventListener('click', () => {
                if (btn.classList.contains('disabled')) return;
                grid.querySelectorAll('.answer-btn').forEach(b => b.classList.add('disabled'));

                const isCorrect = q.Answers.map(a => a.toLowerCase()).includes(answer.toLowerCase());
                btn.classList.add(isCorrect ? 'correct' : 'wrong');

                // Show correct answer if wrong
                if (!isCorrect) {
                    grid.querySelectorAll('.answer-btn').forEach(b => {
                        if (q.Answers.map(a => a.toLowerCase()).includes(b.textContent.toLowerCase())) {
                            b.classList.add('correct');
                        }
                    });
                }

                recordAnswer(q, [answer], isCorrect);
            });
            grid.appendChild(btn);
        });
    }

    function renderQuizMultiAnswerQuestion(q, grid) {
        const allAnswers = [...q.Answers, ...q.IncorrectAnswers];
        shuffleArray(allAnswers);
        const selected = new Set();

        const hint = document.createElement('p');
        hint.className = 'multi-select-hint';
        hint.textContent = `Select ${q.Answers.length} answer(s), then submit`;
        grid.appendChild(hint);

        allAnswers.forEach(answer => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.textContent = answer;
            btn.addEventListener('click', () => {
                if (btn.classList.contains('disabled')) return;
                if (selected.has(answer)) {
                    selected.delete(answer);
                    btn.classList.remove('selected');
                } else {
                    selected.add(answer);
                    btn.classList.add('selected');
                }
            });
            grid.appendChild(btn);
        });

        const submitBtn = document.createElement('button');
        submitBtn.className = 'btn btn-primary submit-answers-btn';
        submitBtn.textContent = 'Submit Answers';
        submitBtn.addEventListener('click', () => {
            if (selected.size === 0) return;
            grid.querySelectorAll('.answer-btn').forEach(b => b.classList.add('disabled'));
            submitBtn.disabled = true;

            const correctSet = new Set(q.Answers.map(a => a.toLowerCase()));
            const selectedArr = [...selected];
            const allCorrect = selectedArr.every(a => correctSet.has(a.toLowerCase())) &&
                selectedArr.length === q.Answers.length;

            grid.querySelectorAll('.answer-btn').forEach(b => {
                if (correctSet.has(b.textContent.toLowerCase())) {
                    b.classList.add('correct');
                } else if (selected.has(b.textContent)) {
                    b.classList.add('wrong');
                }
            });

            recordAnswer(q, selectedArr, allCorrect);
        });
        grid.appendChild(submitBtn);
    }

    function renderQuizGeneralQuestion(q, grid) {
        const inputWrap = document.createElement('div');
        inputWrap.className = 'general-input-wrap';

        if (q.RegExDescription) {
            const hint = document.createElement('p');
            hint.className = 'input-hint';
            hint.textContent = q.RegExDescription;
            inputWrap.appendChild(hint);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'general-answer-input';
        input.placeholder = 'Type your answer...';
        inputWrap.appendChild(input);

        const submitBtn = document.createElement('button');
        submitBtn.className = 'btn btn-primary';
        submitBtn.textContent = 'Submit';
        submitBtn.addEventListener('click', async () => {
            const val = input.value.trim();
            if (!val) return;
            input.disabled = true;
            submitBtn.disabled = true;

            let isCorrect = false;
            if (q.RegEx) {
                try {
                    const regex = new RegExp(q.RegEx, 'i');
                    isCorrect = regex.test(val);
                } catch { isCorrect = false; }
            } else {
                isCorrect = q.Answers.some(a => a.toLowerCase() === val.toLowerCase());
            }

            input.classList.add(isCorrect ? 'correct' : 'wrong');

            if (!isCorrect) {
                const correctP = document.createElement('p');
                correctP.className = 'correct-answer-reveal';
                correctP.textContent = `Correct answer: ${q.Answers.join(', ')}`;
                inputWrap.appendChild(correctP);
            }

            recordAnswer(q, [val], isCorrect);
        });
        inputWrap.appendChild(submitBtn);

        input.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
        grid.appendChild(inputWrap);
    }

    function renderQuizHiddenQuestion(q, grid) {
        // Hidden questions are informational — record after the user has had a chance to read.
        q.Answers.forEach(answer => {
            const spoiler = document.createElement('div');
            spoiler.className = 'spoiler-block';
            spoiler.textContent = '🔍 Click to reveal';
            spoiler.addEventListener('click', () => {
                spoiler.textContent = answer;
                spoiler.classList.add('revealed');
            });
            grid.appendChild(spoiler);
        });

        // Enable Next — answer is recorded when the user advances
        quizState.pendingHidden = q;
        $('quizNextBtn').disabled = false;
    }

    async function recordAnswer(q, selectedAnswers, isCorrect) {
        if (quizState.submitting || quizState.answeredIds.has(q.id)) return;
        quizState.submitting = true;

        const timeTaken = (Date.now() - quizState.questionStartTime) / 1000;

        if (isCorrect) quizState.correctCount++;
        quizState.answeredCount++;
        quizState.answeredIds.add(q.id);

        // Show description if available
        if (q.Description) {
            const descEl = $('quizDescription');
            descEl.textContent = q.Description;
            show(descEl);
        }

        // Post to server
        try {
            const result = await api('/answer', {
                method: 'POST',
                body: JSON.stringify({
                    userId: quizState.user.id,
                    sessionId: quizState.activeSession.id,
                    questionId: q.id,
                    selectedAnswers,
                    isCorrect,
                    timeTakenSeconds: Math.round(timeTaken * 10) / 10
                })
            });
            if (!result.success && !result.duplicate) {
                console.error('Failed to save answer:', result.error);
                showToast('Failed to save answer', 'error');
            }
        } catch (e) {
            console.error('Failed to save answer:', e);
            showToast('Connection error saving answer', 'error');
        }

        updateQuizProgress();
        $('quizNextBtn').disabled = false;
        quizState.submitting = false;
    }

    function updateQuizProgress() {
        const total = (quizState.activeSession?.totalQuestions || 0);
        const answered = quizState.answeredCount;
        $('quizProgressText').textContent = `${answered} / ${total}`;
        const pct = total > 0 ? (answered / total) * 100 : 0;
        $('quizProgressFill').style.width = `${pct}%`;
    }

    async function completeQuiz() {
        hideAllScreens();
        quizState.currentScreen = 'quizComplete';
        show($('quizCompleteScreen'));
        updateNav();

        try {
            const data = await api('/quiz/complete', {
                method: 'POST',
                body: JSON.stringify({
                    userId: quizState.user.id,
                    sessionId: quizState.activeSession.id
                })
            });

            if (data.success) {
                const r = data.result;
                $('quizResultScore').textContent = `${r.percentage}%`;
                $('quizResultDetail').textContent = `${r.correctAnswers} / ${r.totalQuestions} correct`;
                if (r.totalTimeSeconds) {
                    const mins = Math.floor(r.totalTimeSeconds / 60);
                    const secs = Math.round(r.totalTimeSeconds % 60);
                    $('quizResultTime').textContent = `Time: ${mins}m ${secs}s`;
                }

                // Trophy based on score
                if (r.percentage >= 90) $('quizTrophy').textContent = '🏆';
                else if (r.percentage >= 70) $('quizTrophy').textContent = '🥈';
                else if (r.percentage >= 50) $('quizTrophy').textContent = '🥉';
                else $('quizTrophy').textContent = '📝';

                // Load per-question breakdown
                loadQuizBreakdown();
            }
        } catch (e) {
            console.error('Failed to complete quiz:', e);
        }
    }

    async function loadQuizBreakdown() {
        const container = $('quizResultBreakdown');
        if (!container) return;
        try {
            const data = await api(`/my-answers?userId=${quizState.user.id}&sessionId=${quizState.activeSession.id}`);
            if (!data.success || !data.answers || data.answers.length === 0) return;

            const correct = data.answers.filter(a => a.isCorrect).length;
            const wrong = data.answers.length - correct;

            container.innerHTML = `
                <div class="breakdown-summary">
                    <span class="breakdown-correct">✅ ${correct} correct</span>
                    <span class="breakdown-wrong">❌ ${wrong} wrong</span>
                </div>
                <div class="breakdown-list">
                    ${data.answers.map((a, i) => `
                        <div class="breakdown-item ${a.isCorrect ? 'bd-correct' : 'bd-wrong'}">
                            <div class="bd-num">${i + 1}</div>
                            <div class="bd-body">
                                <p class="bd-question">${escapeHtml(a.question)}</p>
                                <p class="bd-answer"><strong>Your answer:</strong> ${escapeHtml(a.selectedAnswers.join(', '))}</p>
                                ${!a.isCorrect ? `<p class="bd-correct-answer"><strong>Correct:</strong> ${escapeHtml(a.correctAnswers.join(', '))}</p>` : ''}
                                <span class="bd-meta">${escapeHtml(a.category || '')} · ${a.difficulty}${a.timeTakenSeconds ? ' · ' + a.timeTakenSeconds + 's' : ''}</span>
                            </div>
                            <div class="bd-icon">${a.isCorrect ? '✅' : '❌'}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            console.error('Failed to load breakdown:', e);
        }
    }

    // ==================== ADMIN PANEL ====================
    function showAdminPanel() {
        hideAllScreens();
        quizState.currentScreen = 'admin';
        show($('adminPanel'));
        loadAdminData();
        updateNav();
    }

    function initAdminListeners() {
        // Tabs
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
                tab.classList.add('active');
                const target = tab.dataset.adminTab;
                $(`admin${target.charAt(0).toUpperCase() + target.slice(1)}Tab`)?.classList.remove('hidden');

                if (target === 'sessions') loadSessions();
                if (target === 'results') loadResults();
                if (target === 'users') loadUsers();
            });
        });

        // Toggle freeplay (checkbox)
        $('freeplayToggleInput')?.addEventListener('change', async (e) => {
            const newVal = e.target.checked;
            const updateData = await api('/admin/config', {
                method: 'POST',
                body: JSON.stringify({ freeplay: newVal })
            });
            if (updateData.success) {
                quizState.config.freeplay = newVal;
                showToast(`Freeplay is now ${newVal ? 'ON' : 'OFF'}`);
                updateNav();
            } else {
                e.target.checked = !newVal; // revert
                showToast('Failed to toggle freeplay', 'error');
            }
        });

        // Logout (admin only — clears admin token, returns to auth/quiz)
        $('adminLogoutBtn')?.addEventListener('click', () => {
            quizState.adminToken = null;
            sessionStorage.removeItem('tq_admin_token');
            showToast('Logged out of admin');
            if (quizState.user) {
                loadAndStartQuiz();
            } else {
                showAuthScreen();
            }
        });

        // Create session
        $('createSessionBtn')?.addEventListener('click', () => {
            quizState.editingSessionId = null;
            $('sessionFormTitle').textContent = 'Create Quiz Session';
            $('sessionName').value = '';
            $('sessionDesc').value = '';
            $('sessionTimeLimit').value = '';
            $('sessionRandomize').checked = false;
            show($('sessionFormCard'));
            loadCategoryPicker();
        });

        $('cancelSessionBtn')?.addEventListener('click', () => hide($('sessionFormCard')));
        $('cancelSessionBtn2')?.addEventListener('click', () => hide($('sessionFormCard')));
        $('saveSessionBtn')?.addEventListener('click', saveSession);

        // Charts collapsible toggle
        $('chartsToggle')?.addEventListener('click', () => {
            const section = $('chartsToggle').closest('.admin-collapsible');
            if (section) section.classList.toggle('collapsed');
        });

        // User search filter
        $('userSearchInput')?.addEventListener('input', () => {
            const q = $('userSearchInput').value.toLowerCase();
            document.querySelectorAll('.user-row').forEach(row => {
                const searchText = (row.dataset.search || row.textContent).toLowerCase();
                row.style.display = searchText.includes(q) ? '' : 'none';
            });
        });

        // Export buttons
        $('exportSummaryBtn')?.addEventListener('click', () => exportResults('summary'));
        $('exportDetailedBtn')?.addEventListener('click', () => exportResults('detailed'));

        // Results session filter
        $('resultsSessionFilter')?.addEventListener('change', loadResults);

        // Logo upload (admin panel)
        $('adminLogoInput')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) return showToast('Only image files are allowed', 'error');
            if (file.size > 2 * 1024 * 1024) return showToast('Logo must be under 2 MB', 'error');
            const formData = new FormData();
            formData.append('file', file);
            try {
                const resp = await fetch('/api/admin/logo', {
                    method: 'POST',
                    headers: { 'X-Admin-Token': quizState.adminToken },
                    body: formData,
                });
                const data = await resp.json();
                if (data.success) {
                    applyCustomLogo(`/api/logo?v=${Date.now()}`);
                    showToast('Logo updated');
                } else {
                    showToast(data.error || 'Upload failed', 'error');
                }
            } catch { showToast('Upload failed', 'error'); }
            e.target.value = '';
        });

        $('adminLogoResetBtn')?.addEventListener('click', async () => {
            try {
                const resp = await fetch('/api/admin/logo', {
                    method: 'DELETE',
                    headers: { 'X-Admin-Token': quizState.adminToken },
                });
                const data = await resp.json();
                if (data.success) {
                    applyCustomLogo('logo.svg');
                    showToast('Logo reset to default');
                } else {
                    showToast(data.error || 'Reset failed', 'error');
                }
            } catch { showToast('Reset failed', 'error'); }
        });

        // Retake quiz button on complete screen
        $('quizRetakeBtn')?.addEventListener('click', () => loadAndStartQuiz());

        // Profile buttons (nav handles main profile, but keep modal close/save)
        $('profileCloseBtn')?.addEventListener('click', () => hide($('userProfileModal')));
        $('profileSaveBtn')?.addEventListener('click', saveProfile);

        // Admin edit-user modal
        $('editUserCancelBtn')?.addEventListener('click', () => hide($('adminEditUserModal')));
        $('editUserSaveBtn')?.addEventListener('click', saveEditUser);

        // Quiz next button
        $('quizNextBtn')?.addEventListener('click', () => {
            // Record deferred hidden-question answer before advancing
            if (quizState.pendingHidden) {
                const q = quizState.pendingHidden;
                quizState.pendingHidden = null;
                recordAnswer(q, q.Answers, true);
            }
            quizState.currentIndex++;
            if (quizState.currentIndex >= quizState.quizQuestions.length) {
                completeQuiz();
            } else {
                showQuizQuestion();
            }
        });
    }

    async function loadAdminData() {
        const [sessData, configData, usersData, resultsData] = await Promise.all([
            api('/admin/sessions').catch(() => null),
            api('/admin/config').catch(() => null),
            api('/admin/users').catch(() => null),
            api('/admin/results/summary').catch(() => null)
        ]);

        // Freeplay toggle
        if (configData?.success) updateFreeplayButton(configData.config.freeplay);

        // Tab badges
        const sessionCount = sessData?.sessions?.length ?? 0;
        const userCount = usersData?.users?.length ?? 0;
        const resultCount = resultsData?.success ? (resultsData.summary?.userScores?.length ?? 0) : 0;
        const badge = (id, n) => { const el = $(id); if (el) el.textContent = n > 0 ? n : ''; };
        badge('badgeSessions', sessionCount);
        badge('badgeResults', resultCount);
        badge('badgeUsers', userCount);

        // Active session indicator
        const activeSession = sessData?.sessions?.find(s => s.isActive);
        const indicator = $('adminActiveSession');
        if (indicator) indicator.textContent = activeSession ? `Active: ${activeSession.name}` : 'No active session';

        // Render sessions list
        if (sessData?.success) renderSessionsList(sessData.sessions);
        await loadSessionFilter();
    }

    // ==================== SESSIONS MANAGEMENT ====================
    async function loadSessions() {
        try {
            const data = await api('/admin/sessions');
            if (!data.success) return;
            renderSessionsList(data.sessions);
        } catch (e) {
            console.error('Failed to load sessions:', e);
        }
    }

    function renderSessionsList(sessions) {
        const container = $('sessionsList');
        if (!sessions || sessions.length === 0) {
            container.innerHTML = '<p class="empty-state">No sessions created yet. Click "+ New Session" to create one.</p>';
            return;
        }

        container.innerHTML = sessions.map(s => `
            <div class="session-card ${s.isActive ? 'active-session' : ''}">
                <div class="session-card-header">
                    <div>
                        <h3>
                            <span class="session-status-dot ${s.isActive ? 'active' : 'inactive'}"></span>
                            ${escapeHtml(s.name)}
                            ${s.isActive ? '<span class="active-badge">LIVE</span>' : ''}
                        </h3>
                        <div class="session-info">
                            <p class="session-meta">📁 ${s.categories.length} categories</p>
                            <p class="session-meta">👥 ${s.participantCount} participants</p>
                            ${s.timeLimitMinutes ? `<p class="session-meta">⏱ ${s.timeLimitMinutes}m</p>` : ''}
                        </div>
                        ${s.description ? `<p class="session-desc">${escapeHtml(s.description)}</p>` : ''}
                    </div>
                    <div class="session-actions">
                        ${s.isActive
                ? `<button class="btn btn-warning btn-sm" onclick="window._quizAdmin.deactivateSession(${s.id})" title="Deactivate">⏹ Stop</button>`
                : `<button class="btn btn-primary btn-sm" onclick="window._quizAdmin.activateSession(${s.id})" title="Activate">▶ Start</button>`}
                        <button class="btn btn-secondary btn-sm" onclick="window._quizAdmin.editSession(${s.id})" title="Edit">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="window._quizAdmin.deleteSession(${s.id})" title="Delete">🗑</button>
                    </div>
                </div>
                <div class="session-categories">
                    ${s.categories.map(c => `
                        <span class="session-cat-tag">${escapeHtml(c.categoryName)}${c.difficulty ? ` (${c.difficulty})` : ''}${c.questionLimit ? ` [max ${c.questionLimit}]` : ''}</span>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    async function loadCategoryPicker() {
        const picker = $('sessionCategoryPicker');
        try {
            const data = await api('/categories');
            if (!data.success) return;

            picker.innerHTML = data.categories.map(c => `
                <label class="category-pick-item">
                    <input type="checkbox" value="${c.id}" data-name="${escapeHtml(c.name)}" data-count="${c.questionCount}">
                    <span>${escapeHtml(c.name)} <small>(${c.questionCount} questions)</small></span>
                </label>
            `).join('');
        } catch {
            picker.innerHTML = '<p class="error-state">Failed to load categories</p>';
        }
    }

    async function saveSession() {
        const name = $('sessionName').value.trim();
        if (!name) return alert('Session name is required');

        const categories = [];
        $('sessionCategoryPicker').querySelectorAll('input:checked').forEach(cb => {
            categories.push({ categoryId: parseInt(cb.value) });
        });

        if (categories.length === 0) return alert('Select at least one category');

        const body = {
            name,
            description: $('sessionDesc').value.trim(),
            timeLimitMinutes: parseInt($('sessionTimeLimit').value) || null,
            randomizeQuestions: $('sessionRandomize').checked,
            categories
        };

        try {
            let data;
            if (quizState.editingSessionId) {
                data = await api(`/admin/sessions/${quizState.editingSessionId}`, {
                    method: 'PUT', body: JSON.stringify(body)
                });
            } else {
                data = await api('/admin/sessions', {
                    method: 'POST', body: JSON.stringify(body)
                });
            }

            if (data.success) {
                hide($('sessionFormCard'));
                showToast(quizState.editingSessionId ? 'Session updated' : 'Session created');
                await loadSessions();
                await loadSessionFilter();
            } else {
                showToast(data.error || 'Failed to save session', 'error');
            }
        } catch (e) {
            showToast('Failed to save session', 'error');
        }
    }

    // Exposed functions for onclick handlers
    window._quizAdmin = {
        activateSession: async (id) => {
            const data = await api(`/admin/sessions/${id}/activate`, { method: 'POST' });
            if (data.success) {
                showToast('Session activated');
                await loadSessions();
                await loadSessionFilter();
            } else {
                showToast(data.error || 'Failed to activate session', 'error');
            }
        },
        deactivateSession: async (id) => {
            const data = await api(`/admin/sessions/${id}/deactivate`, { method: 'POST' });
            if (data.success) {
                showToast('Session deactivated');
                await loadSessions();
                await loadSessionFilter();
            } else {
                showToast(data.error || 'Failed to deactivate session', 'error');
            }
        },
        editSession: async (id) => {
            try {
                const data = await api('/admin/sessions');
                const session = data.sessions.find(s => s.id === id);
                if (!session) return;

                quizState.editingSessionId = id;
                $('sessionFormTitle').textContent = 'Edit Quiz Session';
                $('sessionName').value = session.name;
                $('sessionDesc').value = session.description || '';
                $('sessionTimeLimit').value = session.timeLimitMinutes || '';
                $('sessionRandomize').checked = session.randomizeQuestions;

                show($('sessionFormCard'));
                await loadCategoryPicker();

                // Pre-check categories
                const catIds = session.categories.map(c => c.categoryId);
                $('sessionCategoryPicker').querySelectorAll('input').forEach(cb => {
                    cb.checked = catIds.includes(parseInt(cb.value));
                });
            } catch (e) {
                console.error(e);
            }
        },
        deleteSession: async (id) => {
            if (!confirm('Delete this session and all related results?')) return;
            const data = await api(`/admin/sessions/${id}`, { method: 'DELETE' });
            if (data.success) {
                showToast('Session deleted');
                await loadSessions();
                await loadSessionFilter();
            } else {
                showToast(data.error || 'Failed to delete session', 'error');
            }
        },
        viewUserAnswers: async (userId, sessionId, username) => {
            try {
                const data = await api(`/admin/results/${userId}/answers?sessionId=${sessionId}`);
                if (!data.success) return;

                const modal = document.createElement('div');
                modal.className = 'modal-overlay';
                modal.id = 'userAnswersModal';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width:800px;max-height:80vh;overflow-y:auto">
                        <div class="modal-header">
                            <h2>${escapeHtml(username)}'s Answers</h2>
                            <button class="btn btn-secondary btn-icon" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                        </div>
                        <div class="user-answers-list">
                            ${data.answers.map((a, i) => `
                                <div class="user-answer-item ${a.isCorrect ? 'correct' : 'incorrect'}">
                                    <div class="ua-num">${i + 1}</div>
                                    <div class="ua-body">
                                        <p class="ua-question">${escapeHtml(a.question)}</p>
                                        <p class="ua-selected"><strong>Selected:</strong> ${escapeHtml(a.selectedAnswers.join(', '))}</p>
                                        <p class="ua-correct"><strong>Correct:</strong> ${escapeHtml(a.correctAnswers.join(', '))}</p>
                                        <p class="ua-meta">${a.category || ''} &bull; ${a.difficulty} &bull; ${a.timeTakenSeconds ? a.timeTakenSeconds + 's' : ''}</p>
                                    </div>
                                    <div class="ua-status">${a.isCorrect ? '✅' : '❌'}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            } catch (e) {
                console.error(e);
            }
        }
    };

    // ==================== RESULTS & CHARTS ====================
    async function loadSessionFilter() {
        try {
            const data = await api('/admin/sessions');
            if (!data.success) return;
            const select = $('resultsSessionFilter');
            select.innerHTML = '<option value="">All Sessions</option>';
            data.sessions.forEach(s => {
                select.innerHTML += `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
            });
        } catch (e) { }
    }

    async function loadResults() {
        const sessionId = $('resultsSessionFilter')?.value || '';
        try {
            const [summaryData, resultsData] = await Promise.all([
                api(`/admin/results/summary${sessionId ? '?sessionId=' + sessionId : ''}`),
                api(`/admin/results${sessionId ? '?sessionId=' + sessionId : ''}`)
            ]);

            // Populate stat cards
            if (summaryData.success) {
                const s = summaryData.summary;
                const totalQuizzes = s.userScores?.length ?? 0;
                const avgScore = totalQuizzes > 0 ? Math.round(s.userScores.reduce((a, u) => a + u.percentage, 0) / totalQuizzes) : 0;
                const passRate = totalQuizzes > 0 ? Math.round(s.userScores.filter(u => u.percentage >= 70).length / totalQuizzes * 100) : 0;
                const totalAnswers = s.categoryAccuracy?.reduce((a, c) => a + (c.total || 0), 0) ?? 0;
                const sv = (id, v) => { const el = $(id); if (el) el.textContent = v; };
                sv('statTotalQuizzes', totalQuizzes);
                sv('statAvgScore', avgScore + '%');
                sv('statPassRate', passRate + '%');
                sv('statTotalQuestions', totalAnswers);

                // Render charts in separate try/catch so table still renders if Chart.js fails
                try { renderCharts(s); } catch (chartErr) {
                    console.error('Chart rendering failed:', chartErr);
                }
            }
            if (resultsData.success) renderResultsTable(resultsData.results);

            // Also load live activity
            loadActivity();
        } catch (e) {
            console.error('Failed to load results:', e);
        }
    }

    async function loadActivity() {
        try {
            const data = await api('/admin/activity');
            const container = $('quizActivity');
            if (!container) return;

            if (!data.success || !data.activity || data.activity.length === 0) {
                container.innerHTML = '<p class="empty-state">No in-progress quizzes right now.</p>';
                return;
            }

            container.innerHTML = `
                <h4>📡 Live Quiz Activity</h4>
                <div class="activity-list">
                    ${data.activity.map(a => `
                        <div class="activity-item">
                            <div class="activity-user">
                                <strong>${escapeHtml(a.username)}</strong>
                                <span class="activity-session">${escapeHtml(a.sessionName)}</span>
                            </div>
                            <div class="activity-stats">
                                <span class="activity-answers">${a.answersCount} answered</span>
                                <span class="activity-correct">${a.correctCount} correct</span>
                                <span class="activity-time">${a.lastAnswerAt ? timeAgo(a.lastAnswerAt) : ''}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            console.error('Failed to load activity:', e);
        }
    }

    function timeAgo(dateStr) {
        const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function renderCharts(summary) {
        // Destroy existing charts
        Object.values(quizState.charts).forEach(c => c.destroy());
        quizState.charts = {};

        const colors = [
            'rgba(139,92,246,0.7)', 'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)',
            'rgba(245,158,11,0.7)', 'rgba(239,68,68,0.7)', 'rgba(236,72,153,0.7)',
            'rgba(99,102,241,0.7)', 'rgba(20,184,166,0.7)'
        ];

        // User scores bar chart
        if (summary.userScores.length > 0) {
            quizState.charts.userScores = new Chart($('userScoresChart'), {
                type: 'bar',
                data: {
                    labels: summary.userScores.map(u => u.username),
                    datasets: [{
                        label: 'Score (%)',
                        data: summary.userScores.map(u => u.percentage),
                        backgroundColor: colors,
                        borderRadius: 6,
                    }]
                },
                options: {
                    responsive: true,
                    scales: { y: { beginAtZero: true, max: 100, ticks: { color: '#999' } }, x: { ticks: { color: '#999' } } },
                    plugins: { legend: { display: false } }
                }
            });
        }

        // Category accuracy
        if (summary.categoryAccuracy.length > 0) {
            quizState.charts.category = new Chart($('categoryChart'), {
                type: 'doughnut',
                data: {
                    labels: summary.categoryAccuracy.map(c => c.category),
                    datasets: [{
                        data: summary.categoryAccuracy.map(c => c.percentage),
                        backgroundColor: colors,
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { position: 'bottom', labels: { color: '#999' } } }
                }
            });
        }

        // Difficulty accuracy
        if (summary.difficultyAccuracy.length > 0) {
            quizState.charts.difficulty = new Chart($('difficultyChart'), {
                type: 'bar',
                data: {
                    labels: summary.difficultyAccuracy.map(d => d.difficulty),
                    datasets: [
                        {
                            label: 'Correct',
                            data: summary.difficultyAccuracy.map(d => d.correct),
                            backgroundColor: 'rgba(16,185,129,0.7)',
                            borderRadius: 6,
                        },
                        {
                            label: 'Incorrect',
                            data: summary.difficultyAccuracy.map(d => d.total - d.correct),
                            backgroundColor: 'rgba(239,68,68,0.5)',
                            borderRadius: 6,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { stacked: true, ticks: { color: '#999' } },
                        y: { stacked: true, beginAtZero: true, ticks: { color: '#999' } }
                    },
                    plugins: { legend: { labels: { color: '#999' } } }
                }
            });
        }
    }

    function renderResultsTable(results) {
        const container = $('resultsTable');
        if (results.length === 0) {
            container.innerHTML = '<p class="empty-state">No results yet.</p>';
            return;
        }

        container.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr><th>User</th><th>Session</th><th>Score</th><th>Correct</th><th>Time</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${results.map(r => `
                        <tr>
                            <td>${escapeHtml(r.username)}</td>
                            <td>${escapeHtml(r.sessionName)}</td>
                            <td><span class="score-badge ${r.percentage >= 70 ? 'good' : r.percentage >= 50 ? 'ok' : 'low'}">${r.percentage}%</span></td>
                            <td>${r.correctAnswers}/${r.totalQuestions}</td>
                            <td>${r.totalTimeSeconds ? Math.round(r.totalTimeSeconds) + 's' : '-'}</td>
                            <td>${r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '-'}</td>
                            <td><button class="btn btn-secondary btn-sm" onclick="window._quizAdmin.viewUserAnswers(${r.userId}, ${r.sessionId}, '${escapeHtml(r.username)}')">View Answers</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    async function loadUsers() {
        try {
            const data = await api('/admin/users');
            if (!data.success) return;

            const container = $('usersTable');
            const users = data.users;

            // Populate user stat cards
            const sv = (id, v) => { const el = $(id); if (el) el.textContent = v; };
            sv('statTotalUsers', users.length);
            const weekAgo = Date.now() - 7 * 86400000;
            const activeCount = users.filter(u => u.lastActive && new Date(u.lastActive).getTime() > weekAgo).length;
            sv('statActiveUsers', activeCount);

            if (users.length === 0) {
                container.innerHTML = '<p class="empty-state">No users registered yet.</p>';
                return;
            }

            container.innerHTML = users.map(u => {
                const nameDisplay = u.displayName ? escapeHtml(u.displayName) : escapeHtml(u.username);
                const usernameSmall = u.displayName ? `<small>@${escapeHtml(u.username)}</small>` : '';
                const roleText = u.role ? escapeHtml(u.role) : '<span class="ur-label">—</span>';
                const orgText = u.organization ? escapeHtml(u.organization) : '';
                const emailText = u.email ? escapeHtml(u.email) : '';
                const phoneText = u.phone ? escapeHtml(u.phone) : '';
                const avgScoreVal = u.avgScore ?? 0;
                const scoreClass = avgScoreVal >= 70 ? 'good' : avgScoreVal >= 50 ? 'ok' : 'low';
                return `
                <div class="user-row" data-search="${escapeHtml((u.displayName || '') + ' ' + u.username + ' ' + (u.email || '') + ' ' + (u.organization || ''))}">
                    <div class="user-row-user ul-col ul-col-user">
                        <div class="user-identicon">${generateIdenticon(u.username)}</div>
                        <div class="user-row-name">
                            <strong>${nameDisplay}</strong>
                            ${usernameSmall}
                        </div>
                    </div>
                    <div class="user-row-role ul-col ul-col-role">
                        <span>${roleText}</span>
                        <span class="ur-label">${orgText}</span>
                    </div>
                    <div class="user-row-contact ul-col ul-col-contact">
                        <span>${emailText || '<span class="ur-label">—</span>'}</span>
                        <span>${phoneText}</span>
                    </div>
                    <div class="user-row-stats ul-col ul-col-stats">
                        <span>${u.quizCount} quizzes</span>
                        <span class="ur-score score-badge ${scoreClass}">${avgScoreVal}% avg</span>
                    </div>
                    <div class="user-row-actions ul-col ul-col-actions">
                        <button class="btn btn-secondary btn-sm" onclick="window._quizAdmin.editUser(${u.id})" title="Edit">✏️</button>
                        <button class="btn btn-secondary btn-sm" onclick="window._quizAdmin.resetPassword(${u.id}, '${escapeHtml(u.username)}')" title="Reset Password">🔑</button>
                        <button class="btn btn-danger btn-sm" onclick="window._quizAdmin.deleteUser(${u.id}, '${escapeHtml(u.username)}')" title="Delete">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            console.error('Failed to load users:', e);
        }
    }

    window._quizAdmin.deleteUser = async (id, username) => {
        if (!confirm(`Delete user "${username || id}" and all their results? This cannot be undone.`)) return;
        const data = await api(`/admin/users/${id}`, { method: 'DELETE' });
        if (data.success) {
            showToast('User deleted');
            await loadUsers();
        } else {
            showToast(data.error || 'Failed to delete user', 'error');
        }
    };

    window._quizAdmin.resetPassword = async (id, username) => {
        const newPw = prompt(`Enter new password for "${username}":`);
        if (!newPw) return;
        if (newPw.length < 3) return showToast('Password too short (min 3 chars)', 'error');
        const data = await api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password: newPw }) });
        if (data.success) {
            showToast(`Password reset for ${username}`);
        } else {
            showToast(data.error || 'Failed to reset password', 'error');
        }
    };

    // ==================== USER PROFILE ====================
    async function openProfile() {
        if (!quizState.user) return;
        try {
            const data = await api(`/user/profile?userId=${quizState.user.id}`);
            if (!data.success) return showToast(data.error || 'Could not load profile', 'error');
            const p = data.profile;
            $('profileAvatar').innerHTML = generateIdenticon(p.username || 'user');
            $('profileUsername').textContent = p.username;
            $('profileJoined').textContent = `Joined: ${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-'}`;
            $('profileQuizCount').textContent = p.quizCount ?? 0;
            $('profileAvgScore').textContent = (p.avgScore ?? 0) + '%';
            $('profileLastActive').textContent = p.lastActive ? new Date(p.lastActive).toLocaleDateString() : '-';
            $('profileDisplayName').value = p.displayName || '';
            $('profileEmail').value = p.email || '';
            $('profileBio').value = p.bio || '';
            $('profileRole').value = p.role || '';
            $('profileOrganization').value = p.organization || '';
            $('profilePhone').value = p.phone || '';
            hide($('profileError'));
            show($('userProfileModal'));
        } catch {
            showToast('Could not load profile', 'error');
        }
    }

    async function saveProfile() {
        if (!quizState.user) return;
        const body = {
            userId: quizState.user.id,
            displayName: $('profileDisplayName').value.trim(),
            email: $('profileEmail').value.trim(),
            bio: $('profileBio').value.trim(),
            role: $('profileRole').value.trim(),
            organization: $('profileOrganization').value.trim(),
            phone: $('profilePhone').value.trim()
        };
        try {
            const data = await api('/user/profile', { method: 'PUT', body: JSON.stringify(body) });
            if (data.success) {
                showToast('Profile updated');
                // Update local user state
                quizState.user.displayName = body.displayName;
                quizState.user.email = body.email;
                quizState.user.bio = body.bio;
                quizState.user.role = body.role;
                quizState.user.organization = body.organization;
                quizState.user.phone = body.phone;
                sessionStorage.setItem('tq_user', JSON.stringify(quizState.user));
                updateNav();
                hide($('userProfileModal'));
            } else {
                showError('profileError', data.error || 'Save failed');
            }
        } catch {
            showError('profileError', 'Connection error');
        }
    }

    // ==================== ADMIN EDIT USER ====================
    window._quizAdmin.editUser = async (id) => {
        try {
            const data = await api(`/user/profile?userId=${id}`);
            if (!data.success) return showToast('Could not load user', 'error');
            const p = data.profile;
            $('editUserId').value = id;
            $('editUserUsername').value = p.username || '';
            $('editUserDisplayName').value = p.displayName || '';
            $('editUserEmail').value = p.email || '';
            $('editUserBio').value = p.bio || '';
            $('editUserRole').value = p.role || '';
            $('editUserOrganization').value = p.organization || '';
            $('editUserPhone').value = p.phone || '';
            $('editUserPassword').value = '';
            hide($('editUserError'));
            show($('adminEditUserModal'));
        } catch {
            showToast('Could not load user', 'error');
        }
    };

    async function saveEditUser() {
        const userId = $('editUserId').value;
        if (!userId) return;
        const body = {
            username: $('editUserUsername').value.trim(),
            displayName: $('editUserDisplayName').value.trim(),
            email: $('editUserEmail').value.trim(),
            bio: $('editUserBio').value.trim(),
            role: $('editUserRole').value.trim(),
            organization: $('editUserOrganization').value.trim(),
            phone: $('editUserPhone').value.trim()
        };
        const pw = $('editUserPassword').value;
        if (pw) body.password = pw;
        try {
            const data = await api(`/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify(body) });
            if (data.success) {
                showToast('User updated');
                hide($('adminEditUserModal'));
                await loadUsers();
            } else {
                showError('editUserError', data.error || 'Save failed');
            }
        } catch {
            showError('editUserError', 'Connection error');
        }
    }

    async function exportResults(type) {
        const sessionId = $('resultsSessionFilter')?.value || '';
        const url = `/api/admin/results/export?type=${type}${sessionId ? '&sessionId=' + sessionId : ''}`;
        try {
            const resp = await fetch(url, {
                headers: { 'X-Admin-Token': quizState.adminToken }
            });
            if (!resp.ok) return showToast('Export failed', 'error');
            const blob = await resp.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = resp.headers.get('Content-Disposition')?.split('filename=')[1] || `trivia-results.csv`;
            a.click();
            showToast('Export downloaded');
        } catch (e) {
            showToast('Export failed', 'error');
        }
    }

    // ==================== NAVIGATION ====================
    function updateNav() {
        const nav = $('appNav');
        if (!quizState.apiAvailable) { hide(nav); return; }
        show(nav);

        // Active link
        document.querySelectorAll('.app-nav-link').forEach(l => l.classList.remove('active'));
        const screen = quizState.currentScreen;
        if (screen === 'quiz' || screen === 'quizComplete') {
            $('navQuiz')?.classList.add('active');
        } else if (screen === 'freeplay') {
            $('navFreeplay')?.classList.add('active');
        } else if (screen === 'admin') {
            $('navAdmin')?.classList.add('active');
        }

        // Quiz link: visible only if user is logged in
        if (quizState.user) {
            show($('navQuiz'));
        } else {
            hide($('navQuiz'));
        }

        // Freeplay link: visible if freeplay is enabled
        if (quizState.config?.freeplay) {
            show($('navFreeplay'));
        } else {
            hide($('navFreeplay'));
        }

        // Admin link: always visible
        show($('navAdmin'));

        // User section: show profile+signout if logged in, else show sign-in button
        if (quizState.user) {
            show($('navUser'));
            hide($('navSignIn'));
            $('navUserName').textContent = quizState.user.displayName || quizState.user.username;
            $('navUserAvatar').innerHTML = generateIdenticon(quizState.user.username);
        } else {
            hide($('navUser'));
            show($('navSignIn'));
        }
    }

    // ==================== UTILITIES ====================
    function hideAllScreens() {
        // Hide quiz-mode screens
        hide($('quizAuthScreen'));
        hide($('quizPlayScreen'));
        hide($('quizCompleteScreen'));
        hide($('adminPanel'));
        hide($('adminLoginModal'));
        hide($('userProfileModal'));
        hide($('adminEditUserModal'));
        // Hide freeplay screens
        hide($('welcomeScreen'));
        hide($('gameOverScreen'));
        hide($('questionCounter'));
        hide($('singleMode'));
        hide($('jeopardyMode'));
        hide($('scoreboard'));
        // Hide sidebar hamburger & panel, reset open state
        hide($('sidebarToggle'));
        hide($('sidebar'));
        $('sidebar')?.classList.remove('open');
        $('sidebarToggle')?.classList.remove('active');
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // ==================== IDENTICON GENERATOR ====================
    function generateIdenticon(username) {
        // Simple hash
        let h = 0;
        for (let i = 0; i < username.length; i++) {
            h = ((h << 5) - h + username.charCodeAt(i)) | 0;
        }
        const hue = ((h >>> 0) % 360);
        const color = `hsl(${hue}, 65%, 55%)`;
        const bg = `hsl(${hue}, 25%, 92%)`;
        // 5x5 symmetric grid from hash bits
        let bits = Math.abs(h);
        const cells = [];
        for (let row = 0; row < 5; row++) {
            cells[row] = [];
            for (let col = 0; col < 3; col++) {
                cells[row][col] = bits & 1;
                bits = bits >>> 1;
                if (bits === 0) bits = Math.abs((h * (row + 1) * (col + 1)) | 0) || 1;
            }
            cells[row][3] = cells[row][1];
            cells[row][4] = cells[row][0];
        }
        let rects = '';
        for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
                if (cells[r][c]) rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="${color}"/>`;
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" shape-rendering="crispEdges"><rect width="5" height="5" fill="${bg}"/>${rects}</svg>`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    }

    // ==================== BOOT ====================
    // Wait for DOM and original app to initialize, then layer quiz mode on top
    document.addEventListener('DOMContentLoaded', () => {
        // Small delay to let app.js init() complete first
        setTimeout(() => {
            initAuthListeners();
            initAdminListeners();
            initQuizMode();
        }, 100);
    });

})();
