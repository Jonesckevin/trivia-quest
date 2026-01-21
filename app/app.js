// ==================== STATE ====================
let state = {
    questions: [],
    usedQuestions: new Set(),
    currentQuestion: null,
    currentQuestionIndex: null,
    currentCustomPoints: null,
    currentDisplayedPoints: null,
    teams: [{ name: 'Team 1', score: 0 }],
    teamCount: 1,
    gameMode: 'single', // 'single' or 'jeopardy'
    usePointValues: true,
    l1Points: 100,
    l2Points: 200,
    jeopardyRows: 5,
    maxAvailableRows: 5,
    pointLabel: '',
    pointImageUrl: '',
    pointImageMode: 'none', // 'none', 'replace', 'fullcell'
    answerDifficulty: 'easy', // 'easy' (3 wrong), 'medium' (5 wrong), 'hard' (7 wrong)
    feedbackIntensity: 'full',
    volume: 0.5, // 0 to 1 volume level
    answerRevealed: false
};

// ==================== SAMPLE QUESTIONS ====================
const sampleQuestions = [
    { Category: "Geography", Difficulty: "L1", Question: "What is the capital of France?", Answers: ["Paris"], IncorrectAnswers: ["London", "Berlin", "Madrid", "Rome", "Vienna", "Amsterdam", "Brussels"] },
    { Category: "Geography", Difficulty: "L1", Question: "Which continent is Brazil located in?", Answers: ["South America"], IncorrectAnswers: ["Africa", "Europe", "Asia", "North America", "Australia", "Central America", "Antarctica"] },
    { Category: "Geography", Difficulty: "L2", Question: "What is the smallest country in the world by area?", Answers: ["Vatican City"], IncorrectAnswers: ["Monaco", "San Marino", "Liechtenstein", "Malta", "Andorra", "Luxembourg", "Singapore"] },
    { Category: "Geography", Difficulty: "L2", Question: "Which river is the longest in the world?", Answers: ["Nile", "Amazon"], IncorrectAnswers: ["Mississippi", "Yangtze", "Congo", "Ganges", "Danube", "Mekong", "Volga"] },
    { Category: "Science", Difficulty: "L1", Question: "What planet is known as the Red Planet?", Answers: ["Mars"], IncorrectAnswers: ["Venus", "Jupiter", "Saturn", "Mercury", "Neptune", "Uranus", "Pluto"] },
    { Category: "Science", Difficulty: "L1", Question: "What is the chemical symbol for water?", Answers: ["H2O"], IncorrectAnswers: ["CO2", "NaCl", "O2", "H2", "N2", "CH4", "NH3"] },
    { Category: "Science", Difficulty: "L2", Question: "What is the hardest natural substance on Earth?", Answers: ["Diamond"], IncorrectAnswers: ["Titanium", "Quartz", "Graphene", "Tungsten", "Steel", "Obsidian", "Sapphire"] },
    { Category: "Science", Difficulty: "L2", Question: "What is the speed of light in km/s (approximately)?", Answers: ["300,000", "300000"], IncorrectAnswers: ["150,000", "500,000", "1,000,000", "200,000", "400,000", "250,000", "350,000"] },
    { Category: "History", Difficulty: "L1", Question: "In which year did World War II end?", Answers: ["1945"], IncorrectAnswers: ["1944", "1946", "1943", "1942", "1947", "1941", "1948"] },
    { Category: "History", Difficulty: "L1", Question: "Who was the first President of the United States?", Answers: ["George Washington"], IncorrectAnswers: ["Abraham Lincoln", "Thomas Jefferson", "John Adams", "Benjamin Franklin", "James Madison", "Alexander Hamilton", "John Hancock"] },
    { Category: "History", Difficulty: "L2", Question: "What ancient wonder was located in Alexandria, Egypt?", Answers: ["Lighthouse of Alexandria", "The Lighthouse"], IncorrectAnswers: ["Hanging Gardens", "Colossus of Rhodes", "Temple of Artemis", "Great Pyramid", "Statue of Zeus", "Mausoleum at Halicarnassus", "Library of Alexandria"] },
    { Category: "History", Difficulty: "L2", Question: "Which empire was ruled by Genghis Khan?", Answers: ["Mongol Empire"], IncorrectAnswers: ["Ottoman Empire", "Roman Empire", "Persian Empire", "Byzantine Empire", "Mughal Empire", "Han Dynasty", "Qing Dynasty"] },
    { Category: "Pop Culture", Difficulty: "L1", Question: "What is the name of Harry Potter's owl?", Answers: ["Hedwig"], IncorrectAnswers: ["Errol", "Pigwidgeon", "Scabbers", "Fawkes", "Crookshanks", "Nagini", "Buckbeak"] },
    { Category: "Pop Culture", Difficulty: "L1", Question: "Which band performed 'Bohemian Rhapsody'?", Answers: ["Queen"], IncorrectAnswers: ["The Beatles", "Led Zeppelin", "Pink Floyd", "The Rolling Stones", "AC/DC", "Aerosmith", "Guns N' Roses"] },
    { Category: "Pop Culture", Difficulty: "L2", Question: "What year was the first iPhone released?", Answers: ["2007"], IncorrectAnswers: ["2005", "2008", "2010", "2006", "2009", "2004", "2011"] },
    { Category: "Pop Culture", Difficulty: "L2", Question: "In the movie 'The Matrix', what color pill does Neo take?", Answers: ["Red"], IncorrectAnswers: ["Blue", "Green", "Purple", "Yellow", "Orange", "White", "Black"] }
];

// ==================== AUDIO ====================
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (state.volume === 0) return;
    
    initAudio();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'correct') {
        // Pleasant chime - ascending notes
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
        oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.3 * state.volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
    } else if (type === 'wrong') {
        // Low buzz
        oscillator.frequency.setValueAtTime(150, audioContext.currentTime);
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(0.2 * state.volume, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    }
}

// ==================== DOM ELEMENTS ====================
const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    mainContent: document.getElementById('mainContent'),
    
    // Mode buttons
    singleModeBtn: document.getElementById('singleModeBtn'),
    jeopardyModeBtn: document.getElementById('jeopardyModeBtn'),
    singleMode: document.getElementById('singleMode'),
    jeopardyMode: document.getElementById('jeopardyMode'),
    
    // Team settings
    teamCount: document.getElementById('teamCount'),
    teamNames: document.getElementById('teamNames'),
    
    // Points settings
    usePointValues: document.getElementById('usePointValues'),
    pointSettings: document.getElementById('pointSettings'),
    l1Points: document.getElementById('l1Points'),
    l2Points: document.getElementById('l2Points'),
    
    // Effects
    feedbackIntensity: document.getElementById('feedbackIntensity'),
    volumeSlider: document.getElementById('volumeSlider'),
    volumeIcon: document.getElementById('volumeIcon'),
    volumeLabel: document.getElementById('volumeLabel'),
    answerDifficulty: document.getElementById('answerDifficulty'),
    
    // Jeopardy settings
    jeopardyRows: document.getElementById('jeopardyRows'),
    maxRowsInfo: document.getElementById('maxRowsInfo'),
    pointLabel: document.getElementById('pointLabel'),
    pointImageUrl: document.getElementById('pointImageUrl'),
    pointImageMode: document.getElementById('pointImageMode'),
    imagePreviewGroup: document.getElementById('imagePreviewGroup'),
    pointImagePreview: document.getElementById('pointImagePreview'),
    
    // Question management
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    exportBtn: document.getElementById('exportBtn'),
    addQuestionForm: document.getElementById('addQuestionForm'),
    resetBtn: document.getElementById('resetBtn'),
    
    // Question counter
    questionCounter: document.getElementById('questionCounter'),
    remainingCount: document.getElementById('remainingCount'),
    
    // Single mode elements
    questionCard: document.getElementById('questionCard'),
    currentCategory: document.getElementById('currentCategory'),
    currentDifficulty: document.getElementById('currentDifficulty'),
    currentPoints: document.getElementById('currentPoints'),
    questionText: document.getElementById('questionText'),
    answersGrid: document.getElementById('answersGrid'),
    nextQuestionBtn: document.getElementById('nextQuestionBtn'),
    skipQuestionBtn: document.getElementById('skipQuestionBtn'),
    
    // Jeopardy elements
    jeopardyBoard: document.getElementById('jeopardyBoard'),
    
    // Modal elements
    questionModal: document.getElementById('questionModal'),
    modalCategory: document.getElementById('modalCategory'),
    modalDifficulty: document.getElementById('modalDifficulty'),
    modalPoints: document.getElementById('modalPoints'),
    modalQuestionText: document.getElementById('modalQuestionText'),
    modalAnswersGrid: document.getElementById('modalAnswersGrid'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    
    // Add Question Modal
    addQuestionModal: document.getElementById('addQuestionModal'),
    openAddQuestionBtn: document.getElementById('openAddQuestionBtn'),
    closeAddQuestionBtn: document.getElementById('closeAddQuestionBtn'),
    
    // Scoreboard
    scoreboard: document.getElementById('scoreboard'),
    scoreboardInner: document.getElementById('scoreboardInner'),
    awardPoints: document.getElementById('awardPoints'),
    awardButtons: document.getElementById('awardButtons'),
    noPointsBtn: document.getElementById('noPointsBtn'),
    
    // Inline award sections
    questionActions: document.getElementById('questionActions'),
    singleAwardSection: document.getElementById('singleAwardSection'),
    singleNoPointsBtn: document.getElementById('singleNoPointsBtn'),
    modalCloseSection: document.getElementById('modalCloseSection'),
    modalAwardSection: document.getElementById('modalAwardSection'),
    modalNoPointsBtn: document.getElementById('modalNoPointsBtn')
};

// ==================== STORAGE ====================
function saveState() {
    const saveData = {
        ...state,
        usedQuestions: Array.from(state.usedQuestions)
    };
    localStorage.setItem('triviaQuestState', JSON.stringify(saveData));
}

function loadState() {
    const saved = localStorage.getItem('triviaQuestState');
    if (saved) {
        const parsed = JSON.parse(saved);
        state = {
            ...parsed,
            usedQuestions: new Set(parsed.usedQuestions || [])
        };
        return true;
    }
    return false;
}

// ==================== UI UPDATES ====================
function updateQuestionCounter() {
    const remaining = state.questions.length - state.usedQuestions.size;
    elements.remainingCount.textContent = remaining;
}

// Update volume slider UI
function updateVolumeUI() {
    if (elements.volumeSlider) {
        elements.volumeSlider.value = Math.round(state.volume * 100);
    }
    if (elements.volumeLabel) {
        elements.volumeLabel.textContent = `${Math.round(state.volume * 100)}%`;
    }
    if (elements.volumeIcon) {
        if (state.volume === 0) {
            elements.volumeIcon.textContent = '🔇';
        } else if (state.volume < 0.5) {
            elements.volumeIcon.textContent = '🔉';
        } else {
            elements.volumeIcon.textContent = '🔊';
        }
    }
}

// Show confetti animation on correct answer (full feedback mode)
function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    
    // Create confetti pieces
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * 100}%`;
        confetti.style.animationDelay = `${Math.random() * 0.5}s`;
        confetti.style.animationDuration = `${2 + Math.random() * 2}s`;
        container.appendChild(confetti);
    }
    
    // Remove after animation
    setTimeout(() => container.remove(), 4000);
}

// Add loading state to question card
function setQuestionLoading(loading) {
    if (loading) {
        elements.questionCard.classList.add('loading');
    } else {
        elements.questionCard.classList.remove('loading');
        elements.questionCard.classList.add('fade-in');
        setTimeout(() => elements.questionCard.classList.remove('fade-in'), 300);
    }
}

// Show empty state when no questions
function showEmptyState(container, message = 'No questions loaded') {
    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <div class="empty-state-title">${message}</div>
            <div class="empty-state-text">Import questions from a JSONL file or load sample questions to get started.</div>
        </div>
    `;
}

// Show error alert to user
function showError(title, message) {
    alert(`${title}\n\n${message}`);
}

function updateTeamInputs() {
    elements.teamNames.innerHTML = '';
    
    for (let i = 0; i < state.teamCount; i++) {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
            <input type="text" 
                   class="team-name-input" 
                   data-team="${i}" 
                   value="${state.teams[i]?.name || `Team ${i + 1}`}" 
                   placeholder="Team ${i + 1} name">
        `;
        elements.teamNames.appendChild(div);
    }
    
    // Add event listeners
    document.querySelectorAll('.team-name-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const teamIndex = parseInt(e.target.dataset.team);
            if (state.teams[teamIndex]) {
                state.teams[teamIndex].name = e.target.value;
                updateScoreboard();
                saveState();
            }
        });
    });
}

function updateScoreboard() {
    elements.scoreboard.classList.remove('hidden');
    elements.scoreboardInner.innerHTML = '';
    
    // Show scores for active teams only
    for (let i = 0; i < state.teamCount; i++) {
        const team = state.teams[i];
        const teamDiv = document.createElement('div');
        teamDiv.className = 'team-score';
        teamDiv.innerHTML = `
            <span class="team-name">${team.name}</span>
            <span class="team-points" id="teamScore${i}">${team.score}</span>
        `;
        elements.scoreboardInner.appendChild(teamDiv);
    }
}

function updateAwardButtons() {
    // Update both single mode and modal award buttons
    const containers = [
        { buttons: document.getElementById('singleAwardButtons'), label: document.getElementById('singleAwardLabel'), isModal: false },
        { buttons: document.getElementById('modalAwardButtons'), label: document.getElementById('modalAwardLabel'), isModal: true }
    ];
    
    containers.forEach(({ buttons, label, isModal }) => {
        if (!buttons) return;
        buttons.innerHTML = '';
        
        // Update label
        if (label) {
            label.textContent = state.teamCount <= 1 ? 'Mark as:' : 'Award points to:';
        }
        
        // Use larger buttons for modal
        const btnSize = isModal ? '' : 'btn-small';
        
        if (state.teamCount <= 1) {
            // Solo mode - simple Correct button
            const correctBtn = document.createElement('button');
            correctBtn.className = `btn ${btnSize} btn-success`.trim();
            correctBtn.textContent = '✓ Correct';
            correctBtn.addEventListener('click', () => awardPointsToTeam(0));
            buttons.appendChild(correctBtn);
        } else {
            // Multi-team mode - button per team
            for (let i = 0; i < state.teamCount; i++) {
                const team = state.teams[i];
                const btn = document.createElement('button');
                btn.className = `btn ${btnSize} btn-accent`.trim();
                btn.textContent = team.name;
                btn.addEventListener('click', () => awardPointsToTeam(i));
                buttons.appendChild(btn);
            }
        }
    });
    
    // Also update the footer award buttons for backwards compatibility
    elements.awardButtons.innerHTML = '';
    if (state.teamCount <= 1) {
        const correctBtn = document.createElement('button');
        correctBtn.className = 'btn btn-small btn-success';
        correctBtn.textContent = '✓ Correct';
        correctBtn.addEventListener('click', () => awardPointsToTeam(0));
        elements.awardButtons.appendChild(correctBtn);
    } else {
        for (let i = 0; i < state.teamCount; i++) {
            const team = state.teams[i];
            const btn = document.createElement('button');
            btn.className = 'btn btn-small btn-accent';
            btn.textContent = team.name;
            btn.addEventListener('click', () => awardPointsToTeam(i));
            elements.awardButtons.appendChild(btn);
        }
    }
}

function showAwardButtons() {
    if (state.answerRevealed) {
        updateAwardButtons();
        
        // Show inline award sections based on game mode
        if (state.gameMode === 'jeopardy') {
            // Hide close button, show award section in modal
            const closeSection = document.getElementById('modalCloseSection');
            const awardSection = document.getElementById('modalAwardSection');
            if (closeSection) closeSection.classList.add('hidden');
            if (awardSection) awardSection.classList.remove('hidden');
        } else {
            // Hide next/skip buttons, show award section in single mode
            const questionActions = document.getElementById('questionActions');
            const awardSection = document.getElementById('singleAwardSection');
            if (questionActions) questionActions.classList.add('hidden');
            if (awardSection) awardSection.classList.remove('hidden');
        }
        
        // Also show footer award for backwards compatibility (hidden by CSS if not needed)
        elements.awardPoints.classList.remove('hidden');
        updateAwardLabel();
    }
}

function hideAwardButtons() {
    elements.awardPoints.classList.add('hidden');
    
    // Hide inline award sections and restore original buttons
    const singleAwardSection = document.getElementById('singleAwardSection');
    const questionActions = document.getElementById('questionActions');
    const modalAwardSection = document.getElementById('modalAwardSection');
    const modalCloseSection = document.getElementById('modalCloseSection');
    
    if (singleAwardSection) singleAwardSection.classList.add('hidden');
    if (questionActions) questionActions.classList.remove('hidden');
    if (modalAwardSection) modalAwardSection.classList.add('hidden');
    if (modalCloseSection) modalCloseSection.classList.remove('hidden');
}

function updateAwardLabel() {
    const label = elements.awardPoints.querySelector('.award-label');
    if (label) {
        label.textContent = state.teamCount <= 1 ? 'Mark as:' : 'Award points to:';
    }
}

function awardPointsToTeam(teamIndex) {
    if (!state.currentQuestion) return;
    
    // Use the points that were displayed for this question
    const points = state.currentDisplayedPoints || (state.usePointValues 
        ? (state.currentQuestion.Difficulty === 'L2' ? state.l2Points : state.l1Points)
        : 1);
    
    state.teams[teamIndex].score += points;
    
    // Animate score change
    const scoreEl = document.getElementById(`teamScore${teamIndex}`);
    if (scoreEl) {
        scoreEl.classList.add('score-bump');
        setTimeout(() => scoreEl.classList.remove('score-bump'), 300);
    }
    
    updateScoreboard();
    hideAwardButtons();
    saveState();
    
    // Proceed to next action based on game mode
    proceedAfterAward();
}

function skipAward() {
    hideAwardButtons();
    proceedAfterAward();
}

function proceedAfterAward() {
    if (state.gameMode === 'jeopardy') {
        // Close modal and return to board
        elements.questionModal.classList.add('hidden');
        state.answerRevealed = false;
        state.currentQuestion = null;
        state.currentQuestionIndex = null;
    } else {
        // Single mode - go to next question
        nextQuestion();
    }
}

// ==================== QUESTION LOGIC ====================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getRandomUnusedQuestion() {
    const unusedIndices = [];
    state.questions.forEach((_, index) => {
        if (!state.usedQuestions.has(index)) {
            unusedIndices.push(index);
        }
    });
    
    if (unusedIndices.length === 0) return null;
    
    const randomIndex = unusedIndices[Math.floor(Math.random() * unusedIndices.length)];
    return { question: state.questions[randomIndex], index: randomIndex };
}

function displayQuestion(question, index, isModal = false) {
    state.currentQuestion = question;
    state.currentQuestionIndex = index;
    state.answerRevealed = false;
    hideAwardButtons();
    
    const categoryEl = isModal ? elements.modalCategory : elements.currentCategory;
    const difficultyEl = isModal ? elements.modalDifficulty : elements.currentDifficulty;
    const pointsEl = isModal ? elements.modalPoints : elements.currentPoints;
    const questionEl = isModal ? elements.modalQuestionText : elements.questionText;
    const answersEl = isModal ? elements.modalAnswersGrid : elements.answersGrid;
    
    categoryEl.textContent = question.Category;
    difficultyEl.textContent = question.Difficulty;
    difficultyEl.className = `difficulty-badge ${question.Difficulty.toLowerCase()}`;
    
    // Use custom points from Jeopardy cell if available, otherwise calculate from difficulty
    let points;
    if (state.currentCustomPoints !== null && state.currentCustomPoints !== undefined) {
        points = state.currentCustomPoints;
    } else {
        points = state.usePointValues 
            ? (question.Difficulty === 'L2' ? state.l2Points : state.l1Points)
            : 1;
    }
    state.currentDisplayedPoints = points;
    pointsEl.textContent = `${points} ${state.usePointValues ? 'pts' : 'pt'}`;
    
    questionEl.textContent = question.Question;
    
    // Determine how many incorrect answers to show based on difficulty
    const incorrectCountMap = { easy: 3, medium: 5, hard: 7 };
    const maxIncorrect = incorrectCountMap[state.answerDifficulty] || 3;
    
    // Get available incorrect answers (up to maxIncorrect)
    const availableIncorrect = question.IncorrectAnswers || [];
    const incorrectToShow = shuffleArray([...availableIncorrect]).slice(0, maxIncorrect);
    
    // Combine correct answer(s) with selected incorrect answers
    const allAnswers = [...question.Answers, ...incorrectToShow];
    const shuffledAnswers = shuffleArray(allAnswers);
    
    answersEl.innerHTML = '';
    // Add class for many answers layout
    if (shuffledAnswers.length > 4) {
        answersEl.classList.add('many-answers');
    } else {
        answersEl.classList.remove('many-answers');
    }
    
    // Check if this is a multi-select question (multiple correct answers)
    const isMultiSelect = question.Answers.length > 1;
    
    if (isMultiSelect) {
        // Add hint for multi-select
        const hint = document.createElement('div');
        hint.className = 'multi-select-hint';
        hint.textContent = `Select all ${question.Answers.length} correct answers, then submit`;
        answersEl.appendChild(hint);
    }
    
    shuffledAnswers.forEach(answer => {
        const btn = document.createElement('button');
        btn.className = 'answer-btn';
        btn.textContent = answer;
        
        const isCorrect = question.Answers.some(a => 
            a.toLowerCase() === answer.toLowerCase()
        );
        btn.dataset.correct = isCorrect;
        
        if (isMultiSelect) {
            btn.addEventListener('click', () => toggleAnswerSelection(btn));
        } else {
            btn.addEventListener('click', () => revealAnswer(btn, answersEl));
        }
        answersEl.appendChild(btn);
    });
    
    // Add submit button for multi-select questions
    if (isMultiSelect) {
        const submitBtn = document.createElement('button');
        submitBtn.className = 'submit-answers-btn';
        submitBtn.textContent = 'Submit Answers';
        submitBtn.addEventListener('click', () => submitMultiSelectAnswers(answersEl, question.Answers.length));
        answersEl.appendChild(submitBtn);
    }
    
    if (!isModal) {
        elements.skipQuestionBtn.disabled = false;
    }
}

function toggleAnswerSelection(btn) {
    if (state.answerRevealed) return;
    btn.classList.toggle('selected');
}

function submitMultiSelectAnswers(container, correctCount) {
    if (state.answerRevealed) return;
    state.answerRevealed = true;
    
    const selectedBtns = container.querySelectorAll('.answer-btn.selected');
    const allBtns = container.querySelectorAll('.answer-btn');
    const intensity = state.feedbackIntensity;
    
    // Count correct and incorrect selections
    let correctSelections = 0;
    let incorrectSelections = 0;
    
    selectedBtns.forEach(btn => {
        if (btn.dataset.correct === 'true') {
            correctSelections++;
        } else {
            incorrectSelections++;
        }
    });
    
    // Check if all correct answers are selected and no incorrect ones
    const isFullyCorrect = correctSelections === correctCount && incorrectSelections === 0;
    
    // Play sound based on result
    playSound(isFullyCorrect ? 'correct' : 'wrong');
    
    // Show confetti on fully correct with full feedback
    if (isFullyCorrect && intensity === 'full') {
        showConfetti();
    }
    
    // Mark all buttons
    allBtns.forEach(btn => {
        btn.disabled = true;
        const isCorrect = btn.dataset.correct === 'true';
        const isSelected = btn.classList.contains('selected');
        
        if (isCorrect) {
            // Correct answer - always show as correct
            btn.classList.add('correct', `feedback-${intensity}`);
            if (!isSelected) {
                // Missed correct answer - add visual indicator
                btn.style.opacity = '0.7';
            }
        } else if (isSelected) {
            // Incorrect answer that was selected
            btn.classList.add('incorrect', `feedback-${intensity}`);
        }
    });
    
    // Disable submit button
    const submitBtn = container.querySelector('.submit-answers-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = isFullyCorrect ? '✓ All Correct!' : `${correctSelections}/${correctCount} Correct`;
    }
    
    // Mark question as used
    if (state.currentQuestionIndex !== null) {
        state.usedQuestions.add(state.currentQuestionIndex);
        updateQuestionCounter();
        saveState();
        
        // Update Jeopardy cell if in that mode
        if (state.gameMode === 'jeopardy') {
            const cell = document.querySelector(`[data-question-index="${state.currentQuestionIndex}"]`);
            if (cell) {
                cell.classList.add('used');
            }
        }
    }
    
    // Show award buttons for teams
    showAwardButtons();
}

function revealAnswer(clickedBtn, container) {
    if (state.answerRevealed) return;
    state.answerRevealed = true;
    
    const isCorrect = clickedBtn.dataset.correct === 'true';
    const intensity = state.feedbackIntensity;
    
    // Mark the clicked button
    clickedBtn.classList.add(isCorrect ? 'correct' : 'incorrect');
    clickedBtn.classList.add(`feedback-${intensity}`);
    
    // Play sound
    playSound(isCorrect ? 'correct' : 'wrong');
    
    // Show confetti on correct answer with full feedback
    if (isCorrect && intensity === 'full') {
        showConfetti();
    }
    
    // Reveal all correct answers
    container.querySelectorAll('.answer-btn').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.correct === 'true' && btn !== clickedBtn) {
            btn.classList.add('correct', `feedback-${intensity}`);
        }
    });
    
    // Mark question as used
    if (state.currentQuestionIndex !== null) {
        state.usedQuestions.add(state.currentQuestionIndex);
        updateQuestionCounter();
        saveState();
        
        // Update Jeopardy cell if in that mode
        if (state.gameMode === 'jeopardy') {
            const cell = document.querySelector(`[data-question-index="${state.currentQuestionIndex}"]`);
            if (cell) {
                cell.classList.add('used');
            }
        }
    }
    
    // Show award buttons for teams
    showAwardButtons();
}

function nextQuestion() {
    initAudio(); // Initialize audio on user interaction
    
    state.currentCustomPoints = null; // Reset custom points for single mode
    
    // Show loading state
    setQuestionLoading(true);
    
    // Small delay for visual feedback
    setTimeout(() => {
        const result = getRandomUnusedQuestion();
        if (!result) {
            setQuestionLoading(false);
            elements.questionText.textContent = "No more questions! Import more or reset.";
            elements.answersGrid.innerHTML = '';
            elements.skipQuestionBtn.disabled = true;
            return;
        }
        
        displayQuestion(result.question, result.index);
        setQuestionLoading(false);
    }, 150);
}

function skipQuestion() {
    nextQuestion();
}

// ==================== JEOPARDY BOARD ====================
function buildJeopardyBoard() {
    if (state.questions.length === 0) {
        showEmptyState(elements.jeopardyBoard, 'No questions loaded');
        return;
    }
    
    // Group questions by category
    const categories = {};
    state.questions.forEach((q, index) => {
        if (!categories[q.Category]) {
            categories[q.Category] = [];
        }
        categories[q.Category].push({ question: q, index });
    });
    
    const categoryNames = Object.keys(categories); // All categories
    
    // Determine max available rows based on questions
    const maxQuestionsPerCategory = Math.max(...categoryNames.map(cat => categories[cat].length));
    state.maxAvailableRows = maxQuestionsPerCategory;
    
    // Update the UI to show max available
    if (elements.jeopardyRows) {
        elements.jeopardyRows.max = maxQuestionsPerCategory;
        // Auto-adjust rows: if current is higher than max, reduce; if lower than max and user hasn't manually set, suggest max
        if (state.jeopardyRows > maxQuestionsPerCategory) {
            state.jeopardyRows = maxQuestionsPerCategory;
            elements.jeopardyRows.value = maxQuestionsPerCategory;
        }
        // If more rows are now available and we're at the old max, increase to new max
        if (state.jeopardyRows < maxQuestionsPerCategory && elements.jeopardyRows.value == state.jeopardyRows) {
            // Keep current value but update the max
        }
    }
    if (elements.maxRowsInfo) {
        elements.maxRowsInfo.textContent = `(max: ${maxQuestionsPerCategory})`;
    }
    
    // Use the lesser of requested rows or available questions
    const numRows = Math.min(state.jeopardyRows, maxQuestionsPerCategory);
    
    // If numRows is 0, default to showing all available rows
    const actualRows = numRows > 0 ? numRows : maxQuestionsPerCategory;
    
    // Point values for each row (scales based on base points)
    const basePoints = state.l1Points;
    
    elements.jeopardyBoard.innerHTML = '';
    elements.jeopardyBoard.style.setProperty('--category-count', categoryNames.length + 1); // +1 for row label column
    
    // Create header row
    const headerRow = document.createElement('div');
    headerRow.className = 'jeopardy-row header-row';
    
    // Add empty corner cell
    const cornerCell = document.createElement('div');
    cornerCell.className = 'jeopardy-cell corner-cell';
    cornerCell.textContent = '';
    headerRow.appendChild(cornerCell);
    
    categoryNames.forEach(cat => {
        const cell = document.createElement('div');
        cell.className = 'jeopardy-cell header-cell';
        cell.textContent = cat.toUpperCase();
        headerRow.appendChild(cell);
    });
    elements.jeopardyBoard.appendChild(headerRow);
    
    // Shuffle questions within each category for variety
    const shuffledCategories = {};
    categoryNames.forEach(cat => {
        shuffledCategories[cat] = shuffleArray([...categories[cat]]);
    });
    
    // Create rows for each point value
    const animations = ['springIn', 'bounceIn', 'flipIn', 'slideInLeft', 'slideInRight', 'slideInUp'];
    
    for (let rowIndex = 0; rowIndex < actualRows; rowIndex++) {
        const row = document.createElement('div');
        row.className = 'jeopardy-row';
        
        // Points scale by row: row 1 = base, row 2 = 2x base, etc.
        const points = state.usePointValues ? basePoints * (rowIndex + 1) : 1;
        
        // Add row label cell on the left (numbered)
        const rowLabelCell = document.createElement('div');
        rowLabelCell.className = 'jeopardy-cell row-label-cell';
        rowLabelCell.textContent = rowIndex + 1;
        row.appendChild(rowLabelCell);
        
        categoryNames.forEach((cat, colIndex) => {
            const cell = document.createElement('div');
            cell.className = 'jeopardy-cell value-cell';
            
            const categoryQuestions = shuffledCategories[cat];
            
            if (rowIndex < categoryQuestions.length) {
                const questionData = categoryQuestions[rowIndex];
                cell.dataset.questionIndex = questionData.index;
                cell.dataset.points = points;
                
                // Apply custom point display based on settings
                if (state.pointImageMode === 'fullcell' && state.pointImageUrl) {
                    // Full cell background image
                    cell.classList.add('image-fullcell');
                    cell.style.backgroundImage = `url('${state.pointImageUrl}')`;
                    cell.innerHTML = `<span class="cell-points-overlay">${formatPointDisplay(points)}</span>`;
                } else if (state.pointImageMode === 'replace' && state.pointImageUrl) {
                    // Image replaces text
                    cell.innerHTML = `<img src="${state.pointImageUrl}" alt="${points}" class="cell-point-image"><span class="cell-points-small">${points}</span>`;
                } else {
                    // Text only (default or custom label)
                    cell.textContent = formatPointDisplay(points);
                }
                
                if (state.usedQuestions.has(questionData.index)) {
                    cell.classList.add('used');
                }
                
                // Random animation
                const randomAnim = animations[Math.floor(Math.random() * animations.length)];
                cell.style.animation = `${randomAnim} 0.5s ease-out forwards`;
                cell.style.animationDelay = `${(colIndex * 0.08) + (rowIndex * 0.15)}s`;
                
                cell.addEventListener('click', () => openJeopardyQuestion(questionData.index, points));
            } else {
                cell.textContent = '-';
                cell.classList.add('empty');
            }
            
            row.appendChild(cell);
        });
        
        elements.jeopardyBoard.appendChild(row);
    }
}

// Format point display based on settings
function formatPointDisplay(points) {
    if (state.pointLabel && state.pointLabel.trim()) {
        return `${points} ${state.pointLabel}`;
    }
    return state.usePointValues ? `$${points}` : '1 PT';
}

function openJeopardyQuestion(index, customPoints = null) {
    if (state.usedQuestions.has(index)) return;
    
    const question = state.questions[index];
    state.currentCustomPoints = customPoints;
    displayQuestion(question, index, true);
    elements.questionModal.classList.remove('hidden');
}

function closeModal() {
    elements.questionModal.classList.add('hidden');
    hideAwardButtons();
    state.answerRevealed = false;
    state.currentQuestion = null;
    state.currentQuestionIndex = null;
}

// ==================== IMPORT/EXPORT ====================
function cleanValue(val) {
    if (typeof val === 'string') {
        // Remove Excel-style ="..." wrapping
        if (val.startsWith('="') && val.endsWith('"')) {
            val = val.slice(2, -1);
        }
        // Remove leading/trailing quotes if doubled
        val = val.replace(/^""|""$/g, '"');
        // Unescape escaped quotes
        val = val.replace(/""/g, '"');
    }
    return val;
}

function cleanQuestion(q) {
    return {
        Category: cleanValue(q.Category || ''),
        Difficulty: cleanValue(q.Difficulty || 'L1'),
        Question: cleanValue(q.Question || ''),
        Answers: (q.Answers || []).map(a => cleanValue(a)),
        IncorrectAnswers: (q.IncorrectAnswers || []).map(a => cleanValue(a))
    };
}

function parseJSONL(text) {
    const lines = text.trim().split('\n');
    const questions = [];
    
    lines.forEach(line => {
        try {
            if (line.trim()) {
                const parsed = JSON.parse(line);
                questions.push(cleanQuestion(parsed));
            }
        } catch (e) {
            console.warn('Failed to parse line:', line, e);
        }
    });
    
    return questions;
}

function exportToJSONL() {
    const lines = state.questions.map(q => JSON.stringify(q));
    const content = lines.join('\n');
    
    const blob = new Blob([content], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions.jsonl';
    a.click();
    
    URL.revokeObjectURL(url);
}

function importFromFile(file) {
    const reader = new FileReader();
    
    reader.onerror = () => {
        showError('Import Error', 'Failed to read the file. Please try again.');
    };
    
    reader.onload = (e) => {
        try {
            const content = e.target.result;
            
            if (!content || content.trim().length === 0) {
                showError('Import Error', 'The file appears to be empty.');
                return;
            }
            
            const questions = parseJSONL(content);
            
            if (questions.length === 0) {
                showError('Import Error', 'No valid questions found in the file. Please check the JSONL format.');
                return;
            }
            
            state.questions = [...state.questions, ...questions];
            state.usedQuestions.clear();
            
            // Recalculate max rows and update if needed
            const categories = {};
            state.questions.forEach(q => {
                if (!categories[q.Category]) categories[q.Category] = 0;
                categories[q.Category]++;
            });
            const maxRows = Math.max(...Object.values(categories));
            if (elements.jeopardyRows) {
                elements.jeopardyRows.max = maxRows;
                // If current rows is at or near max, expand to new max
                if (state.jeopardyRows >= state.maxAvailableRows || !state.maxAvailableRows) {
                    state.jeopardyRows = maxRows;
                    elements.jeopardyRows.value = maxRows;
                }
            }
            
            updateQuestionCounter();
            if (state.gameMode === 'jeopardy') {
                buildJeopardyBoard();
            }
            saveState();
            alert(`Successfully imported ${questions.length} questions!`);
        } catch (error) {
            console.error('Import error:', error);
            showError('Import Error', 'Failed to parse the file. Please ensure it is a valid JSONL file.');
        }
    };
    reader.readAsText(file);
}

function loadSampleQuestions() {
    state.questions = [...sampleQuestions];
    state.usedQuestions.clear();
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    alert('Loaded 16 sample questions!');
}

// ==================== ADD QUESTION ====================
function addQuestion(e) {
    e.preventDefault();
    
    const category = document.getElementById('newCategory').value.trim();
    const difficulty = document.getElementById('newDifficulty').value;
    const question = document.getElementById('newQuestion').value.trim();
    const answers = document.getElementById('newAnswers').value.split(',').map(a => a.trim()).filter(a => a);
    const incorrect = document.getElementById('newIncorrect').value.split(',').map(a => a.trim()).filter(a => a);
    
    if (incorrect.length < 3 || incorrect.length > 7) {
        alert('Please provide between 3 and 7 incorrect answers.');
        return;
    }
    
    const newQ = {
        Category: category,
        Difficulty: difficulty,
        Question: question,
        Answers: answers,
        IncorrectAnswers: incorrect
    };
    
    state.questions.push(newQ);
    updateQuestionCounter();
    if (state.gameMode === 'jeopardy') {
        buildJeopardyBoard();
    }
    saveState();
    
    // Reset form and close modal
    e.target.reset();
    closeAddQuestionModal();
    alert('Question added!');
}

// ==================== RESET ====================
function resetAll() {
    if (!confirm('Are you sure you want to reset all data? This will clear all questions, scores, and settings.')) {
        return;
    }
    
    localStorage.removeItem('triviaQuestState');
    localStorage.removeItem('sidebarCollapsedSections');
    
    state = {
        questions: [],
        usedQuestions: new Set(),
        currentQuestion: null,
        currentQuestionIndex: null,
        currentCustomPoints: null,
        currentDisplayedPoints: null,
        teams: [{ name: 'Team 1', score: 0 }],
        teamCount: 1,
        gameMode: 'single',
        usePointValues: true,
        l1Points: 100,
        l2Points: 200,
        jeopardyRows: 5,
        maxAvailableRows: 5,
        pointLabel: '',
        pointImageUrl: '',
        pointImageMode: 'none',
        answerDifficulty: 'easy',
        feedbackIntensity: 'full',
        volume: 0.5,
        answerRevealed: false
    };
    
    // Reset UI
    elements.teamCount.value = '1';
    elements.usePointValues.checked = true;
    elements.l1Points.value = '100';
    elements.l2Points.value = '200';
    elements.jeopardyRows.value = '5';
    elements.pointLabel.value = '';
    elements.pointImageUrl.value = '';
    elements.pointImageMode.value = 'none';
    elements.answerDifficulty.value = 'easy';
    elements.feedbackIntensity.value = 'full';
    elements.volumeSlider.value = '50';
    updateVolumeUI();
    elements.imagePreviewGroup.classList.add('hidden');
    
    updateTeamInputs();
    updateScoreboard();
    updateQuestionCounter();
    setGameMode('single');
    
    elements.questionText.textContent = 'Press "Next Question" to start!';
    elements.answersGrid.innerHTML = '';
    elements.skipQuestionBtn.disabled = true;
    
    alert('All data has been reset!');
}

// ==================== GAME MODE ====================
function setGameMode(mode) {
    state.gameMode = mode;
    
    if (mode === 'single') {
        elements.singleMode.classList.remove('hidden');
        elements.jeopardyMode.classList.add('hidden');
        elements.singleModeBtn.classList.add('active');
        elements.jeopardyModeBtn.classList.remove('active');
    } else {
        elements.singleMode.classList.add('hidden');
        elements.jeopardyMode.classList.remove('hidden');
        elements.singleModeBtn.classList.remove('active');
        elements.jeopardyModeBtn.classList.add('active');
        buildJeopardyBoard();
    }
    
    saveState();
}

// ==================== SIDEBAR ====================
function toggleSidebar() {
    elements.sidebar.classList.toggle('open');
    elements.sidebarToggle.classList.toggle('active');
}

// Accordion toggle for control sections
function initAccordion() {
    const sections = document.querySelectorAll('.control-section[data-section]');
    
    // Load collapsed state from localStorage
    const savedState = localStorage.getItem('sidebarCollapsedSections');
    const collapsedSections = savedState ? JSON.parse(savedState) : ['points'];
    
    sections.forEach(section => {
        const sectionId = section.dataset.section;
        const header = section.querySelector('h3');
        
        // Apply saved collapsed state
        if (collapsedSections.includes(sectionId)) {
            section.classList.add('collapsed');
        }
        
        // Add click handler to toggle
        if (header) {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                section.classList.toggle('collapsed');
                saveAccordionState();
            });
        }
    });
}

function saveAccordionState() {
    const sections = document.querySelectorAll('.control-section[data-section]');
    const collapsedSections = [];
    
    sections.forEach(section => {
        if (section.classList.contains('collapsed')) {
            collapsedSections.push(section.dataset.section);
        }
    });
    
    localStorage.setItem('sidebarCollapsedSections', JSON.stringify(collapsedSections));
}

// ==================== ADD QUESTION MODAL ====================
function openAddQuestionModal() {
    const modal = document.getElementById('addQuestionModal');
    modal.classList.remove('hidden');
    document.getElementById('newCategory').focus();
}

function closeAddQuestionModal() {
    const modal = document.getElementById('addQuestionModal');
    modal.classList.add('hidden');
    elements.addQuestionForm.reset();
}

// Update image preview in settings
function updateImagePreview() {
    if (state.pointImageUrl && state.pointImageMode !== 'none') {
        elements.imagePreviewGroup.classList.remove('hidden');
        elements.pointImagePreview.src = state.pointImageUrl;
    } else {
        elements.imagePreviewGroup.classList.add('hidden');
    }
}

// ==================== EVENT LISTENERS ====================
function initEventListeners() {
    // Sidebar
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    
    // Game mode
    elements.singleModeBtn.addEventListener('click', () => setGameMode('single'));
    elements.jeopardyModeBtn.addEventListener('click', () => setGameMode('jeopardy'));
    
    // Team count
    elements.teamCount.addEventListener('change', (e) => {
        state.teamCount = parseInt(e.target.value);
        
        // Ensure we have enough team objects
        while (state.teams.length < state.teamCount) {
            state.teams.push({ name: `Team ${state.teams.length + 1}`, score: 0 });
        }
        
        updateTeamInputs();
        updateScoreboard();
        saveState();
    });
    
    // Points settings
    elements.usePointValues.addEventListener('change', (e) => {
        state.usePointValues = e.target.checked;
        elements.pointSettings.style.display = e.target.checked ? 'block' : 'none';
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    elements.l1Points.addEventListener('change', (e) => {
        state.l1Points = parseInt(e.target.value) || 100;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    elements.l2Points.addEventListener('change', (e) => {
        state.l2Points = parseInt(e.target.value) || 200;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Effects
    elements.feedbackIntensity.addEventListener('change', (e) => {
        state.feedbackIntensity = e.target.value;
        saveState();
    });
    
    // Volume slider
    elements.volumeSlider.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value) / 100;
        state.volume = volume;
        updateVolumeUI();
        saveState();
    });
    
    // Answer difficulty
    elements.answerDifficulty.addEventListener('change', (e) => {
        state.answerDifficulty = e.target.value;
        saveState();
    });
    
    // Jeopardy rows
    elements.jeopardyRows.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 5;
        val = Math.max(1, Math.min(val, state.maxAvailableRows || 10));
        state.jeopardyRows = val;
        e.target.value = val;
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point label customization
    elements.pointLabel.addEventListener('input', (e) => {
        state.pointLabel = e.target.value.slice(0, 3);
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point image URL
    elements.pointImageUrl.addEventListener('input', (e) => {
        state.pointImageUrl = e.target.value.trim();
        updateImagePreview();
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Point image mode
    elements.pointImageMode.addEventListener('change', (e) => {
        state.pointImageMode = e.target.value;
        updateImagePreview();
        if (state.gameMode === 'jeopardy') {
            buildJeopardyBoard();
        }
        saveState();
    });
    
    // Question management
    elements.loadSampleBtn.addEventListener('click', loadSampleQuestions);
    
    elements.importBtn.addEventListener('click', () => {
        elements.importFile.click();
    });
    
    elements.importFile.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            importFromFile(e.target.files[0]);
            e.target.value = '';
        }
    });
    
    elements.exportBtn.addEventListener('click', exportToJSONL);
    
    // Add Question Modal
    elements.openAddQuestionBtn.addEventListener('click', openAddQuestionModal);
    elements.closeAddQuestionBtn.addEventListener('click', closeAddQuestionModal);
    elements.addQuestionModal.addEventListener('click', (e) => {
        if (e.target === elements.addQuestionModal) {
            closeAddQuestionModal();
        }
    });
    
    elements.addQuestionForm.addEventListener('submit', addQuestion);
    
    elements.resetBtn.addEventListener('click', resetAll);
    
    // Single mode controls
    elements.nextQuestionBtn.addEventListener('click', nextQuestion);
    elements.skipQuestionBtn.addEventListener('click', skipQuestion);
    
    // Modal
    elements.closeModalBtn.addEventListener('click', closeModal);
    elements.questionModal.addEventListener('click', (e) => {
        // Only close if clicking overlay and answer not revealed (before answering)
        if (e.target === elements.questionModal && !state.answerRevealed) {
            closeModal();
        }
    });
    
    // Skip/No Points buttons (all three locations)
    elements.noPointsBtn.addEventListener('click', skipAward);
    if (elements.singleNoPointsBtn) {
        elements.singleNoPointsBtn.addEventListener('click', skipAward);
    }
    if (elements.modalNoPointsBtn) {
        elements.modalNoPointsBtn.addEventListener('click', skipAward);
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Escape key - close modal or sidebar
        if (e.key === 'Escape') {
            if (!elements.addQuestionModal.classList.contains('hidden')) {
                closeAddQuestionModal();
                return;
            }
            if (!elements.questionModal.classList.contains('hidden')) {
                closeModal();
            }
            if (elements.sidebar.classList.contains('open')) {
                toggleSidebar();
            }
            return;
        }
        
        // Don't handle keyboard shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        
        // Number keys 1-8 to select answers
        const answerKeys = ['1', '2', '3', '4', '5', '6', '7', '8'];
        if (answerKeys.includes(e.key) && !state.answerRevealed) {
            const answerIndex = parseInt(e.key) - 1;
            const isModalOpen = !elements.questionModal.classList.contains('hidden');
            const answersContainer = isModalOpen ? elements.modalAnswersGrid : elements.answersGrid;
            const answerBtns = answersContainer.querySelectorAll('.answer-btn');
            
            if (answerBtns[answerIndex]) {
                answerBtns[answerIndex].click();
                answerBtns[answerIndex].focus();
            }
            return;
        }
        
        // Enter key - submit multi-select or start next question (only if not awaiting award)
        if (e.key === 'Enter') {
            // Check for multi-select submit button
            const isModalOpen = !elements.questionModal.classList.contains('hidden');
            const answersContainer = isModalOpen ? elements.modalAnswersGrid : elements.answersGrid;
            const submitBtn = answersContainer.querySelector('.submit-answers-btn:not(:disabled)');
            
            if (submitBtn) {
                submitBtn.click();
                return;
            }
            
            // Block proceeding if answer revealed (must use award/skip buttons)
            if (state.answerRevealed) {
                // Don't allow Enter to bypass the award flow
                return;
            }
            
            // If no question displayed, start next question (single mode only)
            if (!state.currentQuestion && state.gameMode === 'single') {
                nextQuestion();
                return;
            }
        }
        
        // Space key - toggle selection for focused answer (multi-select)
        if (e.key === ' ' && e.target.classList.contains('answer-btn')) {
            e.preventDefault();
            e.target.click();
        }
    });
}

// ==================== INITIALIZATION ====================
function init() {
    const hasState = loadState();
    
    // Handle migration from old muted boolean to volume
    if (state.muted !== undefined) {
        state.volume = state.muted ? 0 : 0.5;
        delete state.muted;
        saveState();
    }
    
    if (hasState) {
        // Restore UI from state
        elements.teamCount.value = state.teamCount.toString();
        elements.usePointValues.checked = state.usePointValues;
        elements.pointSettings.style.display = state.usePointValues ? 'block' : 'none';
        elements.l1Points.value = state.l1Points;
        elements.l2Points.value = state.l2Points;
        elements.feedbackIntensity.value = state.feedbackIntensity;
        
        // Restore volume
        if (state.volume !== undefined) {
            updateVolumeUI();
        }
        
        if (elements.jeopardyRows) {
            elements.jeopardyRows.value = state.jeopardyRows || 5;
        }
        if (elements.answerDifficulty) {
            elements.answerDifficulty.value = state.answerDifficulty || 'easy';
        }
        if (elements.pointLabel) {
            elements.pointLabel.value = state.pointLabel || '';
        }
        if (elements.pointImageUrl) {
            elements.pointImageUrl.value = state.pointImageUrl || '';
        }
        if (elements.pointImageMode) {
            elements.pointImageMode.value = state.pointImageMode || 'none';
        }
        updateImagePreview();
    } else {
        // Initialize volume UI for new sessions
        updateVolumeUI();
    }
    
    initEventListeners();
    initAccordion();
    updateTeamInputs();
    updateScoreboard();
    updateQuestionCounter();
    setGameMode(state.gameMode);
    
    // Register service worker for offline support
    registerServiceWorker();
}

// Register service worker for offline PWA support
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker registered:', registration.scope);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
