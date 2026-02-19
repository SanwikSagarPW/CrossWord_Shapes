document.addEventListener('DOMContentLoaded', () => {
    // ============================================
    // ANALYTICS SETUP
    // ============================================
    const analytics = new AnalyticsManager();
    analytics.initialize('crossword_shapes', 'session_' + Date.now());
    
    let levelStartTime = 0;
    let currentLevelId = null;
    let checkAttempts = 0;
    let submitAttempts = 0;
    
    // DOM Elements
    const gridElement = document.getElementById('crossword-grid');
    const acrossCluesElement = document.getElementById('across-clues');
    const downCluesElement = document.getElementById('down-clues');
    const titleElement = document.getElementById('puzzle-title');
    const levelElement = document.getElementById('puzzle-level');
    const checkButton = document.getElementById('check-btn');
    const submitButton = document.getElementById('submit-btn');
    const successOverlay = document.getElementById('success-overlay');
    const timesUpOverlay = document.getElementById('times-up-overlay');
    const incompleteOverlay = document.getElementById('incomplete-overlay');
    const restartButton = document.getElementById('restart-btn');
    const homeButton = document.getElementById('home-btn');
    const incompleteOkButton = document.getElementById('incomplete-ok-btn');
    const timerElement = document.getElementById('timer');
    const scoreDisplayElement = document.getElementById('score-display');
    const adminPanel = document.getElementById('admin-panel');
    const gameContainer = document.querySelector('.game-container');

    // State Management
    let currentPuzzleData = null;
    let gridState;
    let currentDirection = 'across';
    let activeClueInfo = null;
    let lastFocusedCell = { row: -1, col: -1 };
    let timerInterval = null;
    let timeRemaining = 0;
    const GAME_DURATION = 600; // 10 minutes in seconds

    // --- GAME FLOW & INITIALIZATION ---

    async function startGame() {
        try {
            const response = await fetch('puzzle.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            currentPuzzleData = await response.json();
            initializeGame();
        } catch(error) {
            console.error("Failed to start game:", error);
            gridElement.innerHTML = `<p style="color: var(--error-color);">Could not load puzzle. Please check puzzle.json and refresh.</p>`;
        }
    }

    function initializeGame() {
        lastFocusedCell = { row: -1, col: -1 };
        currentDirection = 'across';
        timeRemaining = GAME_DURATION;
        
        try {
            const { metadata, clues } = currentPuzzleData;
            const { rows, cols } = metadata.size;
            titleElement.textContent = metadata.title;
            levelElement.textContent = 'Level 1';
            gridState = Array(rows).fill(null).map(() => Array(cols).fill(null));
            gridElement.style.setProperty('--grid-rows', rows);
            gridElement.style.setProperty('--grid-cols', cols);
            populateGridState(clues.across);
            populateGridState(clues.down);
            renderGrid(rows, cols);
            renderClues(clues.across, acrossCluesElement, 'across');
            renderClues(clues.down, downCluesElement, 'down');
            startTimer();
            
            // ============================================
            // ANALYTICS: Track level start
            // ============================================
            currentLevelId = 'level_' + metadata.title.toLowerCase().replace(/\s+/g, '_');
            analytics.startLevel(currentLevelId);
            levelStartTime = Date.now();
            checkAttempts = 0;
            submitAttempts = 0;
            
            // Track initial metrics
            analytics.addRawMetric('puzzle_name', metadata.title);
            analytics.addRawMetric('grid_size', `${rows}x${cols}`);
            analytics.addRawMetric('across_clues_count', clues.across.length);
            analytics.addRawMetric('down_clues_count', clues.down.length);
        } catch (error) {
            console.error("CRITICAL ERROR building puzzle:", error);
            gridElement.innerHTML = `<p style="color: var(--error-color);">A critical error occurred while building the puzzle.</p>`;
        }
    }
    
    // --- TIMER LOGIC ---

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);

        const updateDisplay = () => {
            const minutes = Math.floor(timeRemaining / 60);
            const seconds = timeRemaining % 60;
            timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        };

        updateDisplay();
        timerInterval = setInterval(() => {
            if (timeRemaining > 0) {
                timeRemaining--;
                updateDisplay();
            } else {
                endGameByTimeUp();
            }
        }, 1000);
    }

    function endGameByTimeUp() {
        clearInterval(timerInterval);
        timerElement.textContent = "0:00";
        
        // ============================================
        // ANALYTICS: Track time-up (failure)
        // ============================================
        const timeTakenMs = GAME_DURATION * 1000;
        
        console.log('[Analytics] Time up! Game ended.');
        analytics.addRawMetric('end_reason', 'time_up');
        analytics.endLevel(currentLevelId, false, timeTakenMs, 0);
        
        console.log('[Analytics] Full Report:', analytics.getReportData());
        analytics.submitReport();
        
        timesUpOverlay.classList.remove('hidden');
        document.querySelectorAll('.cell-input').forEach(input => { input.readOnly = true; });
        checkButton.disabled = true;
        submitButton.disabled = true;
    }

    // --- GRID & CLUE RENDERING ---

    function populateGridState(clueList) {
        clueList.forEach(clue => {
            const answer = clue.answer.toUpperCase();
            for (let i = 0; i < answer.length; i++) {
                const r = clue.direction === 'across' ? clue.row : clue.row + i;
                const c = clue.direction === 'across' ? clue.col + i : clue.col;
                if (!gridState[r][c]) gridState[r][c] = { answer: '', words: [] };
                gridState[r][c].answer = answer[i];
                if (!gridState[r][c].words.some(w => w.number === clue.number && w.direction === clue.direction)) {
                    gridState[r][c].words.push({ number: clue.number, direction: clue.direction });
                }
                if (i === 0) gridState[r][c].clueNumber = clue.number;
            }
        });
    }

    function renderGrid(rows, cols) {
        gridElement.innerHTML = '';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellData = gridState[r][c];
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                
                const devCoords = document.createElement('div');
                devCoords.className = 'dev-coords';
                devCoords.textContent = `${r},${c}`;
                cell.appendChild(devCoords);

                if (!cellData) {
                    cell.classList.add('empty');
                } else {
                    const devAnswer = document.createElement('div');
                    devAnswer.className = 'dev-answer';
                    devAnswer.textContent = cellData.answer;
                    cell.appendChild(devAnswer);

                    if (cellData.clueNumber) {
                        const numDiv = document.createElement('div');
                        numDiv.className = 'clue-number';
                        numDiv.textContent = cellData.clueNumber;
                        cell.appendChild(numDiv);
                    }
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.maxLength = 1;
                    input.className = 'cell-input';
                    input.dataset.answer = cellData.answer.toUpperCase();
                    input.addEventListener('input', handleCellInput);
                    input.addEventListener('focus', () => handleFocus(r, c));
                    input.addEventListener('keydown', handleKeyDown);
                    cell.appendChild(input);
                }
                gridElement.appendChild(cell);
            }
        }
    }

    function renderClues(clueList, listElement, direction) {
        listElement.innerHTML = '';
        clueList.forEach(clue => {
            const li = document.createElement('li');
            li.textContent = `${clue.number}. ${clue.clue}`;
            li.dataset.number = clue.number;
            li.dataset.direction = direction;
            li.addEventListener('click', handleClueClick);
            listElement.appendChild(li);
        });
    }

    // --- USER INPUT & INTERACTION ---

    function handleCellInput(e) {
        e.target.value = e.target.value.toUpperCase();
        if (e.target.value.length === 0 || !activeClueInfo) return;

        const { row: startRow, col: startCol, answer } = activeClueInfo;
        const currentCellPos = e.target.parentElement.dataset;
        let currentWordIndex = (currentDirection === 'across')
            ? parseInt(currentCellPos.col) - startCol
            : parseInt(currentCellPos.row) - startRow;
        
        if (currentWordIndex < answer.length - 1) {
            const nextIndex = currentWordIndex + 1;
            const r = (currentDirection === 'across') ? startRow : startRow + nextIndex;
            const c = (currentDirection === 'across') ? startCol + nextIndex : startCol;
            const nextCell = document.querySelector(`.grid-cell[data-row="${r}"][data-col="${c}"] input`);
            if (nextCell && !nextCell.readOnly) nextCell.focus();
        }
    }

    function handleKeyDown(e) {
        const cell = e.target.parentElement;
        let { row, col } = cell.dataset;
        row = parseInt(row); col = parseInt(col);

        if (e.key === 'Backspace' && e.target.value === '') {
            e.preventDefault();
            const prevR = (currentDirection === 'down') ? row - 1 : row;
            const prevC = (currentDirection === 'across') ? col - 1 : col;
            const prevCell = document.querySelector(`.grid-cell[data-row="${prevR}"][data-col="${prevC}"] input`);
            if (prevCell) prevCell.focus();
            return;
        }

        let nextR = row, nextC = col;
        switch (e.key) {
            case 'ArrowUp': nextR--; break;
            case 'ArrowDown': nextR++; break;
            case 'ArrowLeft': nextC--; break;
            case 'ArrowRight': nextC++; break;
            default: return;
        }
        const nextCell = document.querySelector(`.grid-cell[data-row="${nextR}"][data-col="${nextC}"] input`);
        if (nextCell) {
            e.preventDefault();
            nextCell.focus();
        }
    }
    
    function handleFocus(row, col) {
        const cellData = gridState[row][col];
        if (!cellData) return;
        const hasAcross = cellData.words.some(w => w.direction === 'across');
        const hasDown = cellData.words.some(w => w.direction === 'down');
        
        if (lastFocusedCell.row === row && lastFocusedCell.col === col) {
            if (hasAcross && hasDown) currentDirection = currentDirection === 'across' ? 'down' : 'across';
        } else {
            const isCurrentDirectionValid = (currentDirection === 'across' && hasAcross) || (currentDirection === 'down' && hasDown);
            if (!isCurrentDirectionValid) currentDirection = hasAcross ? 'across' : 'down';
        }
        lastFocusedCell = { row, col };
        highlightWord(row, col, currentDirection);
    }

    function handleClueClick(e) {
        const { number, direction } = e.target.dataset;
        const clue = currentPuzzleData.clues[direction].find(c => c.number == number);
        if (clue) {
            currentDirection = direction;
            const firstCellInput = document.querySelector(`.grid-cell[data-row="${clue.row}"][data-col="${clue.col}"] input`);
            if (firstCellInput) firstCellInput.focus();
        }
    }

    function highlightWord(row, col, direction) {
        document.querySelectorAll('.focused-word, li.highlighted').forEach(el => el.classList.remove('highlighted', 'focused-word'));
        const cellData = gridState[row][col];
        if (!cellData) return;
        const wordInfo = cellData.words.find(w => w.direction === direction);
        if (!wordInfo) return;
        activeClueInfo = currentPuzzleData.clues[direction].find(c => c.number === wordInfo.number);
        if (!activeClueInfo) return;
        document.querySelector(`li[data-number="${activeClueInfo.number}"][data-direction="${direction}"]`)?.classList.add('highlighted');
        for (let i = 0; i < activeClueInfo.answer.length; i++) {
            const r = direction === 'across' ? activeClueInfo.row : activeClueInfo.row + i;
            const c = direction === 'across' ? activeClueInfo.col + i : activeClueInfo.col;
            document.querySelector(`.grid-cell[data-row="${r}"][data-col="${c}"]`)?.classList.add('focused-word');
        }
    }

    // --- PUZZLE CHECKING & SUBMISSION ---

    function checkCompletion() {
        checkAttempts++;
        
        const inputs = document.querySelectorAll('.cell-input');
        let filledCount = 0;
        let emptyCount = 0;
        
        inputs.forEach(input => {
            if (input.value.trim() !== '') {
                filledCount++;
            } else {
                emptyCount++;
            }
        });
        
        const totalCells = inputs.length;
        const completionPercent = totalCells > 0 ? (filledCount / totalCells * 100).toFixed(1) : 0;
        const isComplete = emptyCount === 0;
        
        // ============================================
        // ANALYTICS: Track check attempt
        // ============================================
        console.log('[Analytics] Check attempt #' + checkAttempts, {
            filled: filledCount,
            empty: emptyCount,
            total: totalCells,
            completion: completionPercent + '%'
        });
        
        analytics.recordTask(
            currentLevelId,
            'check_attempt_' + checkAttempts,
            `Check Completion Attempt #${checkAttempts}`,
            'all_filled',
            isComplete ? 'all_filled' : 'incomplete',
            Date.now() - levelStartTime,
            0
        );
        
        analytics.addRawMetric('check_attempts', checkAttempts);
        analytics.addRawMetric('completion_percent', completionPercent);
        analytics.addRawMetric('filled_cells', filledCount);
        analytics.addRawMetric('empty_cells', emptyCount);
        
        console.log('[Analytics] Metrics tracked:', analytics.getReportData().rawData);
        
        if (isComplete) {
            checkButton.classList.add('hidden');
            submitButton.classList.remove('hidden');
        } else {
            incompleteOverlay.classList.remove('hidden');
        }
    }

    function submitPuzzle() {
        submitAttempts++;
        const inputs = document.querySelectorAll('.cell-input');
        let allCorrect = true;
        let correctCount = 0;
        let incorrectCount = 0;
        
        inputs.forEach(input => {
            const enteredValue = input.value.toUpperCase();
            const correctValue = input.dataset.answer;
            if (enteredValue === correctValue) {
                input.classList.add('correct');
                correctCount++;
            } else {
                allCorrect = false;
                incorrectCount++;
                input.classList.add('incorrect-flash');
            }
        });

        const totalCells = inputs.length;
        const accuracy = totalCells > 0 ? (correctCount / totalCells * 100).toFixed(1) : 0;
        
        // ============================================
        // ANALYTICS: Track submit attempt
        // ============================================
        console.log('[Analytics] Submit attempt #' + submitAttempts, {
            correct: correctCount,
            incorrect: incorrectCount,
            total: totalCells,
            accuracy: accuracy + '%',
            allCorrect: allCorrect
        });
        
        analytics.recordTask(
            currentLevelId,
            'submit_attempt_' + submitAttempts,
            `Submit Puzzle Attempt #${submitAttempts}`,
            'all_correct',
            allCorrect ? 'all_correct' : 'has_errors',
            Date.now() - levelStartTime,
            allCorrect ? 50 : 10
        );
        
        analytics.addRawMetric('submit_attempts', submitAttempts);
        analytics.addRawMetric('accuracy_percent', accuracy);
        analytics.addRawMetric('correct_cells', correctCount);
        analytics.addRawMetric('incorrect_cells', incorrectCount);

        if (allCorrect) {
            clearInterval(timerInterval);
            const timeTaken = GAME_DURATION - timeRemaining;
            const timeTakenMs = timeTaken * 1000;
            
            // Calculate XP with bonuses
            let baseXP = 100;
            let finalScore = 50; // Default score
            
            if (timeTaken <= 240) { // less than 4 mins
                finalScore = 200;
            } else if (timeTaken <= 360) { // less than 6 mins
                finalScore = 150;
            } else if (timeTaken <= 480) { // less than 8 mins
                finalScore = 100;
            }
            
            const timeBonus = Math.max(0, 50 - Math.floor(timeTaken / 20));
            const attemptBonus = Math.max(0, 50 - (checkAttempts - 1) * 10);
            const totalXP = baseXP + timeBonus + attemptBonus;
            
            scoreDisplayElement.textContent = finalScore;
            
            // ============================================
            // ANALYTICS: Track completion
            // ============================================
            console.log('[Analytics] Level completed!', {
                timeTaken: (timeTakenMs / 1000).toFixed(2) + 's',
                baseXP: baseXP,
                timeBonus: timeBonus,
                attemptBonus: attemptBonus,
                totalXP: totalXP,
                displayScore: finalScore
            });
            
            analytics.addRawMetric('time_taken_seconds', timeTaken);
            analytics.addRawMetric('final_score', finalScore);
            analytics.endLevel(currentLevelId, true, timeTakenMs, totalXP);
            
            console.log('[Analytics] Full Report:', analytics.getReportData());
            analytics.submitReport();
            
            inputs.forEach(input => input.readOnly = true);
            successOverlay.classList.remove('hidden');
        } else {
            setTimeout(() => {
                inputs.forEach(input => {
                    input.classList.remove('incorrect-flash');
                    if (input.classList.contains('correct')) {
                        input.readOnly = true;
                    }
                });
            }, 2000); // Remove flash after 2 seconds
        }
    }

    // --- SECRET CODES & EVENT LISTENERS ---

    let keySequence = "";
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.key.length > 1) return;
        keySequence += (e.key === '`' || e.key === '~') ? '~' : e.key.toLowerCase();
        
        const codes = {
            "~asd": () => adminPanel.classList.toggle('hidden'),
            "~adev": () => gameContainer.classList.add('dev-mode', 'dev-answers-mode'),
            "~dev": () => {
                gameContainer.classList.toggle('dev-mode');
                gameContainer.classList.remove('dev-answers-mode');
            },
            "~sdev": () => gameContainer.classList.remove('dev-mode', 'dev-answers-mode')
        };

        for (const code in codes) {
            if (keySequence.endsWith(code)) {
                codes[code]();
                keySequence = "";
                return;
            }
        }
        if (keySequence.length > 5) keySequence = keySequence.slice(-5);
    });

    checkButton.addEventListener('click', checkCompletion);
    submitButton.addEventListener('click', submitPuzzle);
    restartButton.addEventListener('click', () => location.reload());
    homeButton.addEventListener('click', () => { window.location.href = 'index.html'; });
    incompleteOkButton.addEventListener('click', () => incompleteOverlay.classList.add('hidden'));
    
    // ============================================
    // ANALYTICS: Capture abandoned games
    // ============================================
    window.addEventListener('beforeunload', () => {
        if (currentLevelId && levelStartTime > 0) {
            const level = analytics._getLevelById(currentLevelId);
            if (level && !level.successful) {
                const timeTaken = Date.now() - levelStartTime;
                analytics.addRawMetric('end_reason', 'abandoned');
                analytics.endLevel(currentLevelId, false, timeTaken, 0);
                analytics.submitReport();
                console.log('[Analytics] Session ended (incomplete)');
            }
        }
    });
    
    // Start Game
    startGame();
});