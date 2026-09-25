/* ═══════════════════════════════════════════════════════════
   OTTv2 — Game Engine + PeerJS Networking
   Multi-match Dashboard & Spectator Mode Enabled
   ═══════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────
const COLS = 'abcdefghi'.split('');
const ROWS = 9; // 1-9
const PIECE_TYPES = { ROCK: 'rock', PAPER: 'paper', SCISSORS: 'scissors' };
const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const VIET_NAME = { rock: 'Đấm', paper: 'Lá', scissors: 'Kéo' };

// Win table: key beats value
const BEATS = {
    [PIECE_TYPES.ROCK]:     PIECE_TYPES.SCISSORS,
    [PIECE_TYPES.SCISSORS]: PIECE_TYPES.PAPER,
    [PIECE_TYPES.PAPER]:    PIECE_TYPES.ROCK,
};

// Special win squares
const SPECIAL_A1 = { col: 0, row: 8 }; // a1
const SPECIAL_I9 = { col: 8, row: 0 }; // i9

// ── Focus Match State ─────────────────────────────────────
let state = {
    board: [],          // 9×9 array
    turn: 1,            // 1 or 2
    myPlayer: null,     // 1, 2, or null (spectator)
    isSpectator: false, // true if spectating
    gameOver: false,
    selected: null,     // { col, row }
    validMoves: [],     // [{ col, row, isAttack }]
    lastMove: null,     // { from: {col,row}, to: {col,row} }
};

// Networking
let peer = null;
let hostConns = [];     // If host: array of all client connections (P2 + Spectators)
let conn = null;          // If client
let roomId = null;
let isHost = false;
let configuredPieceCount = 9;

// ── 3 Side Mini-Board Slots ────────────────────────────────
let sideSlots = [
    { slot: 0, roomId: null, peer: null, conn: null, board: null, turn: 1, connected: false },
    { slot: 1, roomId: null, peer: null, conn: null, board: null, turn: 1, connected: false },
    { slot: 2, roomId: null, peer: null, conn: null, board: null, turn: 1, connected: false },
];

// ── DOM Refs ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const lobbyScreen        = $('lobby-screen');
const gameScreen         = $('game-screen');
const btnCreate          = $('btn-create');
const btnJoin            = $('btn-join');
const btnSpectate        = $('btn-spectate');
const btnOpenDashboard   = $('btn-open-dashboard');
const inputRoom          = $('input-room');
const inputSpectateRoom  = $('input-spectate-room');
const inputPieceCount    = $('input-piece-count');
const totalPiecesLabel   = $('total-pieces-label');
const lobbyStatus        = $('lobby-status');
const lobbyStatusTx      = $('lobby-status-text');
const roomInfo           = $('room-info');
const roomCodeDisp       = $('room-code-value');
const btnCopy            = $('btn-copy');

const boardEl            = $('board');
const turnIndicator      = $('turn-indicator');
const turnText           = $('turn-text');
const gameRoomId         = $('game-room-id');
const roleBadgeTag       = $('role-badge-tag');
const roleBadgeText      = $('role-badge-text');
const spectatorBannerLbl = $('spectator-banner-label');
const spectatorNotice    = $('spectator-lock-notice');
const btnLeaveHud        = $('btn-leave-hud');

const gameLog            = $('game-log');
const victoryOvl         = $('victory-overlay');
const victoryIcon        = $('victory-icon');
const victoryTitle       = $('victory-title');
const victoryDesc        = $('victory-desc');
const btnPlayAgain       = $('btn-play-again');
const btnBackLobby       = $('btn-back-lobby');

const selfPieces         = $('self-pieces');
const oppPieces          = $('opponent-pieces');
const selfName           = $('self-name');
const oppName            = $('opponent-name');

const tabFocus           = $('tab-focus');
const tabSide            = $('tab-side');
const focusArea          = $('focus-area');
const sidePanel          = $('side-panel');
const sideActiveCount    = $('side-active-count');

// ═══════════════════════════════════════════════════════════
//  BOARD INITIALIZATION & GENERATION
// ═══════════════════════════════════════════════════════════

function createInitialBoard(totalPiecesPerSide = 9) {
    const board = Array.from({ length: 9 }, () => Array(9).fill(null));

    // Player 1's territory: lower-left triangle bounded by main diagonal a9 (0,0) to i1 (8,8)
    const p1Cells = [];
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (r > c) {
                p1Cells.push({ r, c });
            }
        }
    }

    const count = Math.max(3, Math.min(36, Math.floor(totalPiecesPerSide || 9)));

    // Pool of pieces for Player 1 (guaranteeing at least 1 of each type: Rock, Paper, Scissors)
    const types = [PIECE_TYPES.ROCK, PIECE_TYPES.PAPER, PIECE_TYPES.SCISSORS];
    const piecesList = [];
    for (let i = 0; i < count; i++) {
        piecesList.push(types[i % 3]);
    }

    const selectedP1Cells = shuffle(p1Cells).slice(0, piecesList.length);
    const shuffledPieces = shuffle(piecesList);

    // Place Player 1 pieces & symmetric Player 2 pieces across diagonal a9 -> i1
    selectedP1Cells.forEach((cell, i) => {
        const pType = shuffledPieces[i];
        board[cell.r][cell.c] = { player: 1, type: pType };
        board[cell.c][cell.r] = { player: 2, type: pType };
    });

    return board;
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ═══════════════════════════════════════════════════════════
//  MAIN BOARD RENDERING
// ═══════════════════════════════════════════════════════════

function buildBoardDOM() {
    boardEl.innerHTML = '';

    const colLabelsTop = $('col-labels-top');
    const colLabelsBot = $('col-labels-bottom');
    colLabelsTop.innerHTML = '';
    colLabelsBot.innerHTML = '';
    COLS.forEach(c => {
        const s1 = document.createElement('span');
        s1.textContent = c;
        colLabelsTop.appendChild(s1);
        const s2 = document.createElement('span');
        s2.textContent = c;
        colLabelsBot.appendChild(s2);
    });

    const rowLabelsL = $('row-labels-left');
    const rowLabelsR = $('row-labels-right');
    rowLabelsL.innerHTML = '';
    rowLabelsR.innerHTML = '';
    for (let r = 0; r < 9; r++) {
        const rowNum = 9 - r;
        const s1 = document.createElement('span');
        s1.textContent = rowNum;
        rowLabelsL.appendChild(s1);
        const s2 = document.createElement('span');
        s2.textContent = rowNum;
        rowLabelsR.appendChild(s2);
    }

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.classList.add((r + c) % 2 === 0 ? 'light' : 'dark');

            if (c === SPECIAL_A1.col && r === SPECIAL_A1.row) cell.classList.add('special-a1');
            if (c === SPECIAL_I9.col && r === SPECIAL_I9.row) cell.classList.add('special-i9');

            cell.addEventListener('click', () => onCellClick(r, c));
            boardEl.appendChild(cell);
        }
    }
}

function renderBoard() {
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach(cell => {
        const r = +cell.dataset.row;
        const c = +cell.dataset.col;
        const piece = state.board && state.board[r] ? state.board[r][c] : null;

        cell.classList.remove('selected', 'valid-move', 'valid-attack', 'last-from', 'last-to', 'capture-anim');

        const oldPiece = cell.querySelector('.piece');
        if (oldPiece) oldPiece.remove();

        if (piece) {
            const el = document.createElement('div');
            el.className = `piece p${piece.player}`;
            el.textContent = EMOJI[piece.type];
            el.title = `${VIET_NAME[piece.type]} (P${piece.player})`;
            cell.appendChild(el);
        }

        if (!state.isSpectator && state.selected && state.selected.row === r && state.selected.col === c) {
            cell.classList.add('selected');
        }

        if (!state.isSpectator && state.validMoves) {
            state.validMoves.forEach(m => {
                if (m.row === r && m.col === c) {
                    cell.classList.add(m.isAttack ? 'valid-attack' : 'valid-move');
                }
            });
        }

        if (state.lastMove) {
            if (state.lastMove.from.row === r && state.lastMove.from.col === c) cell.classList.add('last-from');
            if (state.lastMove.to.row === r && state.lastMove.to.col === c) cell.classList.add('last-to');
        }
    });

    updateHUD();
}

function updateHUD() {
    if (state.isSpectator) {
        spectatorNotice.classList.remove('hidden');
        roleBadgeTag.className = 'role-badge-tag spectator';
        roleBadgeText.textContent = '👁️ Khán giả (Spectator)';
        spectatorBannerLbl.textContent = 'Đang xem ván đấu:';
        turnText.textContent = state.turn === 1 ? '🔴 Lượt Player 1' : '🔵 Lượt Player 2';
        turnIndicator.className = 'turn-indicator opp-turn';

        const counts = { 1: { rock: 0, paper: 0, scissors: 0 }, 2: { rock: 0, paper: 0, scissors: 0 } };
        if (state.board && state.board.length) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    const p = state.board[r][c];
                    if (p) counts[p.player][p.type]++;
                }
            }
        }

        selfPieces.innerHTML = `
            <span class="pc rock" title="Đấm">✊×${counts[1].rock}</span>
            <span class="pc paper" title="Lá">✋×${counts[1].paper}</span>
            <span class="pc scissors" title="Kéo">✌️×${counts[1].scissors}</span>`;
        oppPieces.innerHTML = `
            <span class="pc rock" title="Đấm">✊×${counts[2].rock}</span>
            <span class="pc paper" title="Lá">✋×${counts[2].paper}</span>
            <span class="pc scissors" title="Kéo">✌️×${counts[2].scissors}</span>`;

        selfName.textContent = `Player 1`;
        oppName.textContent = `Player 2`;
        return;
    }

    spectatorNotice.classList.add('hidden');
    spectatorBannerLbl.textContent = 'Phòng:';
    roleBadgeTag.className = 'role-badge-tag player';
    roleBadgeText.textContent = state.myPlayer === 1 ? '🎮 Player 1 (Đội A)' : '🎮 Player 2 (Đội B)';

    const isMyTurn = state.turn === state.myPlayer;
    turnText.textContent = isMyTurn ? '🟢 Lượt của bạn' : '🔴 Lượt đối thủ';
    turnIndicator.className = 'turn-indicator ' + (isMyTurn ? 'my-turn' : 'opp-turn');

    const counts = { 1: { rock: 0, paper: 0, scissors: 0 }, 2: { rock: 0, paper: 0, scissors: 0 } };
    if (state.board && state.board.length) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const p = state.board[r][c];
                if (p) counts[p.player][p.type]++;
            }
        }
    }

    const myP = state.myPlayer || 1;
    const opP = myP === 1 ? 2 : 1;

    selfPieces.innerHTML = `
        <span class="pc rock" title="Đấm">✊×${counts[myP].rock}</span>
        <span class="pc paper" title="Lá">✋×${counts[myP].paper}</span>
        <span class="pc scissors" title="Kéo">✌️×${counts[myP].scissors}</span>`;
    oppPieces.innerHTML = `
        <span class="pc rock" title="Đấm">✊×${counts[opP].rock}</span>
        <span class="pc paper" title="Lá">✋×${counts[opP].paper}</span>
        <span class="pc scissors" title="Kéo">✌️×${counts[opP].scissors}</span>`;

    selfName.textContent = `Player ${myP}`;
    oppName.textContent = `Player ${opP}`;
}

// ═══════════════════════════════════════════════════════════
//  MINI BOARDS (3 SIDE SLOTS FOR DASHBOARD)
// ═══════════════════════════════════════════════════════════

function buildMiniBoardsDOM() {
    sideSlots.forEach((slot, index) => {
        const container = $(`mini-board-${index}`);
        if (!container) return;
        container.innerHTML = '';
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = document.createElement('div');
                cell.className = 'mini-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                cell.classList.add((r + c) % 2 === 0 ? 'light' : 'dark');

                if (c === SPECIAL_A1.col && r === SPECIAL_A1.row) cell.classList.add('special-a1');
                if (c === SPECIAL_I9.col && r === SPECIAL_I9.row) cell.classList.add('special-i9');

                container.appendChild(cell);
            }
        }

        container.onclick = () => focusSideMatch(index);
    });

    // Attach connect & focus button handlers for mini cards
    document.querySelectorAll('.btn-mini-connect').forEach(btn => {
        btn.onclick = (e) => {
            const slot = +e.target.dataset.slot;
            connectMiniSlot(slot);
        };
    });

    document.querySelectorAll('.btn-mini-focus').forEach(btn => {
        btn.onclick = (e) => {
            const slot = +e.target.dataset.slot;
            focusSideMatch(slot);
        };
    });
}

function renderMiniBoard(index) {
    const slot = sideSlots[index];
    const container = $(`mini-board-${index}`);
    const statusEl = $(`mini-status-${index}`);
    if (!container) return;

    const cells = container.querySelectorAll('.mini-cell');
    cells.forEach(cell => {
        const r = +cell.dataset.row;
        const c = +cell.dataset.col;
        const piece = slot.board && slot.board[r] ? slot.board[r][c] : null;

        const oldPiece = cell.querySelector('.mini-piece');
        if (oldPiece) oldPiece.remove();

        if (piece) {
            const el = document.createElement('div');
            el.className = `mini-piece p${piece.player}`;
            el.textContent = EMOJI[piece.type];
            cell.appendChild(el);
        }
    });

    if (statusEl) {
        if (!slot.connected) {
            statusEl.textContent = slot.status || 'Chưa kết nối';
            statusEl.style.color = 'var(--text-muted)';
        } else {
            const turnStr = slot.turn === 1 ? 'P1 lượt' : 'P2 lượt';
            statusEl.textContent = `🟢 ${slot.roomId || 'Phòng'} (${turnStr})`;
            statusEl.style.color = 'var(--accent-cyan)';
        }
    }

    updateActiveSideCount();
}

function updateActiveSideCount() {
    const activeCount = sideSlots.filter(s => s.connected).length;
    if (sideActiveCount) sideActiveCount.textContent = activeCount;
}

function connectMiniSlot(slotIndex) {
    const inputEl = $(`mini-input-${slotIndex}`);
    if (!inputEl) return;
    const code = inputEl.value.trim().toUpperCase();
    if (!code) { inputEl.focus(); return; }

    const slot = sideSlots[slotIndex];
    if (slot.conn) try { slot.conn.close(); } catch(e){}
    if (slot.peer) try { slot.peer.destroy(); } catch(e){}

    slot.roomId = code;
    slot.status = 'Đang kết nối…';
    slot.connected = false;
    renderMiniBoard(slotIndex);

    slot.peer = new Peer(undefined, { debug: 0 });
    slot.peer.on('open', () => {
        const connection = slot.peer.connect('ottv2-' + code, { reliable: true });
        slot.conn = connection;

        const handleData = (data) => {
            if (data && (data.type === 'init' || data.type === 'move' || data.board)) {
                slot.board = data.board;
                slot.turn = data.turn || 1;
                slot.connected = true;
                slot.status = '🟢 Live';
                renderMiniBoard(slotIndex);
            }
        };

        const handleOpen = () => {
            slot.connected = true;
            slot.status = 'Đã kết nối';
            renderMiniBoard(slotIndex);
        };

        connection.on('data', handleData);
        connection.on('close', () => {
            slot.connected = false;
            slot.status = 'Đã ngắt';
            renderMiniBoard(slotIndex);
        });
        connection.on('error', (err) => {
            slot.connected = false;
            slot.status = 'Lỗi kết nối';
            renderMiniBoard(slotIndex);
        });

        if (connection.open) {
            handleOpen();
        } else {
            connection.on('open', handleOpen);
        }
    });

    slot.peer.on('error', (err) => {
        console.error(`Mini slot ${slotIndex} peer error:`, err);
        slot.connected = false;
        slot.status = 'Không tìm thấy phòng';
        renderMiniBoard(slotIndex);
    });
}

function focusSideMatch(slotIndex) {
    const slot = sideSlots[slotIndex];
    if (!slot || !slot.board) {
        alert('Phòng đấu này chưa có dữ liệu!');
        return;
    }

    state.board = slot.board;
    state.turn = slot.turn || 1;
    state.isSpectator = true;
    state.myPlayer = null;
    roomId = slot.roomId || 'MINI';
    gameRoomId.textContent = roomId;

    renderBoard();
    addLog(`👁️ Đã chuyển Bàn cờ chính sang xem phòng: ${roomId}`, 'system');
}

// ═══════════════════════════════════════════════════════════
//  GAME LOGIC
// ═══════════════════════════════════════════════════════════

function getValidMoves(row, col) {
    const piece = state.board[row][col];
    if (!piece) return [];
    const moves = [];
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    dirs.forEach(([dr, dc]) => {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) return;

        const target = state.board[nr][nc];
        if (!target) {
            moves.push({ row: nr, col: nc, isAttack: false });
        } else if (target.player !== piece.player) {
            if (canCapture(piece.type, target.type)) {
                moves.push({ row: nr, col: nc, isAttack: true });
            }
        }
    });

    return moves;
}

function canCapture(attackerType, defenderType) {
    if (attackerType === defenderType) return false;
    return BEATS[attackerType] === defenderType;
}

function onCellClick(row, col) {
    if (state.isSpectator || state.gameOver) return;
    if (state.turn !== state.myPlayer) return;

    const piece = state.board[row][col];

    if (state.selected) {
        const move = state.validMoves.find(m => m.row === row && m.col === col);
        if (move) {
            if (isHost) {
                executeMove(state.selected.row, state.selected.col, row, col, move.isAttack);
            } else {
                // Player 2 sends move request to Host
                sendState({
                    type: 'move_request',
                    fromRow: state.selected.row,
                    fromCol: state.selected.col,
                    toRow: row,
                    toCol: col,
                    isAttack: move.isAttack,
                });
                deselectPiece();
            }
            return;
        }

        if (piece && piece.player === state.myPlayer) {
            selectPiece(row, col);
            return;
        }

        deselectPiece();
        return;
    }

    if (piece && piece.player === state.myPlayer) {
        selectPiece(row, col);
    }
}

function selectPiece(row, col) {
    state.selected = { row, col };
    state.validMoves = getValidMoves(row, col);
    renderBoard();
}

function deselectPiece() {
    state.selected = null;
    state.validMoves = [];
    renderBoard();
}

function executeMove(fromRow, fromCol, toRow, toCol, isAttack) {
    const piece = state.board[fromRow][fromCol];
    const captured = state.board[toRow][toCol];

    state.board[toRow][toCol] = piece;
    state.board[fromRow][fromCol] = null;

    state.lastMove = { from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } };
    state.selected = null;
    state.validMoves = [];

    const fromStr = COLS[fromCol] + (9 - fromRow);
    const toStr   = COLS[toCol] + (9 - toRow);
    if (isAttack && captured) {
        addLog(`${EMOJI[piece.type]} ${fromStr} ⚔️ ${EMOJI[captured.type]} ${toStr}`, 'capture');
    } else {
        addLog(`${EMOJI[piece.type]} ${fromStr} → ${toStr}`, 'move');
    }

    if (isAttack) {
        const idx = toRow * 9 + toCol;
        const cell = boardEl.children[idx];
        if (cell) {
            cell.classList.add('capture-anim');
            setTimeout(() => cell.classList.remove('capture-anim'), 400);
        }
    }

    renderBoard();

    const winner = checkWinCondition();
    if (winner) {
        endGame(winner);
    } else {
        state.turn = state.turn === 1 ? 2 : 1;
        updateHUD();
    }

    // Broadcast updated state to all connected peers (P2 + spectators)
    broadcastState({
        type: 'move',
        board: state.board,
        turn: state.turn,
        lastMove: state.lastMove,
        gameOver: state.gameOver,
        winner: winner,
    });
}

function checkWinCondition() {
    const counts = { 1: { rock: 0, paper: 0, scissors: 0 }, 2: { rock: 0, paper: 0, scissors: 0 } };
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const p = state.board[r][c];
            if (p) counts[p.player][p.type]++;
        }
    }

    const currentPlayer = state.turn;
    const opponent = currentPlayer === 1 ? 2 : 1;
    const opp = counts[opponent];
    if (opp.rock === 0 || opp.paper === 0 || opp.scissors === 0) {
        return currentPlayer;
    }

    const atA1 = state.board[SPECIAL_A1.row][SPECIAL_A1.col];
    if (atA1 && state.lastMove && state.lastMove.to.row === SPECIAL_A1.row && state.lastMove.to.col === SPECIAL_A1.col) {
        return atA1.player;
    }

    const atI9 = state.board[SPECIAL_I9.row][SPECIAL_I9.col];
    if (atI9 && state.lastMove && state.lastMove.to.row === SPECIAL_I9.row && state.lastMove.to.col === SPECIAL_I9.col) {
        return atI9.player;
    }

    return null;
}

function endGame(winner) {
    state.gameOver = true;
    const iWin = winner === state.myPlayer;

    victoryIcon.textContent = iWin ? '🏆' : (state.isSpectator ? '🏁' : '😢');
    victoryTitle.textContent = state.isSpectator ? `Player ${winner} thắng!` : (iWin ? 'Chiến thắng!' : 'Thất bại!');
    victoryDesc.textContent = `Trận đấu kết thúc! Player ${winner} giành chiến thắng.`;
    victoryOvl.classList.remove('hidden');

    addLog(`🏁 Player ${winner} thắng trận!`, 'system');
}

function addLog(text, type = 'move') {
    const li = document.createElement('li');
    li.className = type;
    li.textContent = text;
    gameLog.prepend(li);
    while (gameLog.children.length > 50) gameLog.lastChild.remove();
}

// ═══════════════════════════════════════════════════════════
//  PEERJS NETWORKING & MULTI-PEER BROADCAST
// ═══════════════════════════════════════════════════════════

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function showLobbyStatus(text) {
    lobbyStatus.classList.remove('hidden');
    lobbyStatusTx.textContent = text;
}

function hideLobbyStatus() {
    lobbyStatus.classList.add('hidden');
}

function createRoom() {
    if (inputPieceCount) {
        configuredPieceCount = Math.max(3, Math.min(36, parseInt(inputPieceCount.value) || 9));
    }
    roomId = generateRoomId();
    isHost = true;
    state.myPlayer = 1;
    state.isSpectator = false;

    showLobbyStatus('Đang tạo phòng…');
    btnCreate.disabled = true;
    btnJoin.disabled = true;

    hostConns = [];

    peer = new Peer('ottv2-' + roomId, { debug: 0 });

    peer.on('open', () => {
        showLobbyStatus('Phòng đã tạo! Đang chờ đối thủ & khán giả…');
        roomInfo.classList.remove('hidden');
        roomCodeDisp.textContent = roomId;

        state.board = createInitialBoard(configuredPieceCount);
        state.turn = 1;
        state.gameOver = false;
        state.lastMove = null;
        state.selected = null;
        state.validMoves = [];

        startGame();
    });

    peer.on('connection', (connection) => {
        let assignedRole = 'spectator';
        if (hostConns.length === 0) {
            assignedRole = 'p2';
        }
        hostConns.push(connection);

        const sendInit = () => {
            try {
                connection.send({
                    type: 'init',
                    board: state.board,
                    turn: state.turn,
                    role: assignedRole,
                    roomId: roomId,
                });
                addLog(`📢 ${assignedRole === 'p2' ? 'Player 2' : 'Khán giả'} đã vào phòng`, 'system');
            } catch (err) {
                console.error('Error sending init to peer:', err);
            }
        };

        if (connection.open) {
            sendInit();
        } else {
            connection.on('open', sendInit);
        }

        connection.on('data', (data) => {
            if (data.type === 'move_request') {
                executeMove(data.fromRow, data.fromCol, data.toRow, data.toCol, data.isAttack);
            }
        });

        connection.on('close', () => {
            hostConns = hostConns.filter(c => c !== connection);
            addLog('⚠️ Một kết nối đã rời phòng', 'system');
        });
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        showLobbyStatus(`Lỗi: ${err.message}`);
        btnCreate.disabled = false;
        btnJoin.disabled = false;
    });
}

function joinRoom() {
    const code = inputRoom.value.trim().toUpperCase();
    if (!code) { inputRoom.focus(); return; }

    roomId = code;
    isHost = false;

    showLobbyStatus('Đang kết nối vào phòng…');
    btnCreate.disabled = true;
    btnJoin.disabled = true;

    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('ottv2-' + roomId, { reliable: true });

        const onConnect = () => {
            showLobbyStatus('Đã kết nối! Đang chờ khởi tạo…');
        };

        if (conn.open) {
            onConnect();
        } else {
            conn.on('open', onConnect);
        }

        conn.on('data', (data) => {
            if (data.type === 'init') {
                state.board = data.board;
                state.turn = data.turn;
                if (data.role === 'spectator') {
                    state.isSpectator = true;
                    state.myPlayer = null;
                    addLog('👁️ Bạn tham gia với vai trò Khán giả (Phòng đã đủ 2 người chơi)', 'system');
                } else {
                    state.isSpectator = false;
                    state.myPlayer = 2;
                }
                state.gameOver = false;
                state.lastMove = null;
                state.selected = null;
                state.validMoves = [];
                startGame();
            } else {
                handleMessage(data);
            }
        });

        conn.on('error', (err) => {
            showLobbyStatus(`Lỗi kết nối: ${err.message || err}`);
            btnCreate.disabled = false;
            btnJoin.disabled = false;
        });
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        showLobbyStatus(`Lỗi: ${err.message}`);
        btnCreate.disabled = false;
        btnJoin.disabled = false;
    });
}

function joinSpectator(code) {
    const targetRoom = code || (inputSpectateRoom ? inputSpectateRoom.value.trim().toUpperCase() : '');
    if (!targetRoom) { if (inputSpectateRoom) inputSpectateRoom.focus(); return; }

    roomId = targetRoom;
    isHost = false;
    state.isSpectator = true;
    state.myPlayer = null;

    showLobbyStatus('Đang kết nối xem trận đấu…');
    btnCreate.disabled = true;
    btnJoin.disabled = true;

    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', () => {
        conn = peer.connect('ottv2-' + roomId, { reliable: true });

        const onOpen = () => {
            showLobbyStatus('Đã kết nối Chế độ Khán giả!');
        };

        if (conn.open) {
            onOpen();
        } else {
            conn.on('open', onOpen);
        }

        conn.on('data', (data) => {
            if (data.type === 'init') {
                state.board = data.board;
                state.turn = data.turn;
                state.isSpectator = true;
                state.myPlayer = null;
                state.gameOver = false;
                startGame();
            } else {
                handleMessage(data);
            }
        });

        conn.on('error', (err) => {
            showLobbyStatus(`Lỗi xem trận: ${err.message || err}`);
            btnCreate.disabled = false;
            btnJoin.disabled = false;
        });
    });
}

function broadcastState(data) {
    if (isHost && hostConns.length > 0) {
        hostConns.forEach(c => {
            if (c && c.open) c.send(data);
        });
    } else if (!isHost && conn && conn.open) {
        conn.send(data);
    }
}

function sendState(data) {
    broadcastState(data);
}

function handleMessage(data) {
    switch (data.type) {
        case 'move':
            state.board = data.board;
            state.turn = data.turn;
            state.lastMove = data.lastMove;
            state.selected = null;
            state.validMoves = [];

            if (data.lastMove) {
                const from = data.lastMove.from;
                const to = data.lastMove.to;
                const piece = state.board[to.row][to.col];
                const fromStr = COLS[from.col] + (9 - from.row);
                const toStr = COLS[to.col] + (9 - to.row);
                addLog(`👤 ${piece ? EMOJI[piece.type] : '?'} ${fromStr} → ${toStr}`, 'move');
            }

            if (data.gameOver && data.winner) {
                state.gameOver = true;
                endGame(data.winner);
            }

            renderBoard();
            break;

        case 'init':
            state.board = data.board;
            state.turn = data.turn;
            state.gameOver = false;
            state.lastMove = null;
            state.selected = null;
            state.validMoves = [];
            renderBoard();
            break;

        case 'play-again':
            state.board = data.board;
            state.turn = data.turn;
            state.gameOver = false;
            state.lastMove = null;
            state.selected = null;
            state.validMoves = [];
            victoryOvl.classList.add('hidden');
            gameLog.innerHTML = '';
            addLog('🔄 Ván mới bắt đầu!', 'system');
            renderBoard();
            break;
    }
}

// ═══════════════════════════════════════════════════════════
//  GAME FLOW & DASHBOARD MANAGEMENT
// ═══════════════════════════════════════════════════════════

function startGame() {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameRoomId.textContent = roomId || 'DASHBOARD';

    buildBoardDOM();
    renderBoard();
    buildMiniBoardsDOM();

    addLog('🎮 Trận đấu bắt đầu!', 'system');
    if (state.isSpectator) {
        addLog(`👁️ Bạn đang xem ván đấu phòng: ${roomId}`, 'system');
    } else {
        addLog(`Bạn là Player ${state.myPlayer}`, 'system');
    }
}

function openDashboardDemo() {
    state.isSpectator = true;
    state.myPlayer = null;
    state.board = createInitialBoard(9);
    state.turn = 1;
    roomId = 'MULTI-DASHBOARD';

    // Set sample mini slots
    sideSlots[0].board = createInitialBoard(6);
    sideSlots[0].turn = 1;
    sideSlots[0].connected = true;

    sideSlots[1].board = createInitialBoard(9);
    sideSlots[1].turn = 2;
    sideSlots[1].connected = true;

    sideSlots[2].board = createInitialBoard(12);
    sideSlots[2].turn = 1;
    sideSlots[2].connected = true;

    startGame();
    renderMiniBoard(0);
    renderMiniBoard(1);
    renderMiniBoard(2);

    addLog('📺 Đã bật Chế độ Multi-Match Dashboard (4 Trận)', 'system');
}

function resetGame() {
    if (isHost) {
        const board = createInitialBoard(configuredPieceCount);
        state.board = board;
        state.turn = 1;
        state.gameOver = false;
        state.lastMove = null;
        state.selected = null;
        state.validMoves = [];
        victoryOvl.classList.add('hidden');
        gameLog.innerHTML = '';
        addLog('🔄 Ván mới bắt đầu!', 'system');
        renderBoard();

        broadcastState({
            type: 'play-again',
            board: state.board,
            turn: state.turn,
        });
    } else {
        addLog('⏳ Chỉ host mới có thể bắt đầu ván mới', 'system');
    }
}

function goBackToLobby() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    if (hostConns.length) hostConns.forEach(c => c.close());
    hostConns = [];
    conn = null;
    peer = null;
    roomId = null;
    isHost = false;

    sideSlots.forEach(s => {
        if (s.conn) s.conn.close();
        if (s.peer) s.peer.destroy();
        s.connected = false;
        s.board = null;
    });

    state = {
        board: [],
        turn: 1,
        myPlayer: null,
        isSpectator: false,
        gameOver: false,
        selected: null,
        validMoves: [],
        lastMove: null,
    };

    gameScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
    victoryOvl.classList.add('hidden');
    roomInfo.classList.add('hidden');
    hideLobbyStatus();
    if (btnCreate) btnCreate.disabled = false;
    if (btnJoin) btnJoin.disabled = false;
    if (inputRoom) inputRoom.value = '';
    if (inputSpectateRoom) inputSpectateRoom.value = '';
    gameLog.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════
//  EVENT LISTENERS & MOBILE TABS
// ═══════════════════════════════════════════════════════════

btnCreate.addEventListener('click', createRoom);
btnJoin.addEventListener('click', joinRoom);
if (btnSpectate) btnSpectate.addEventListener('click', () => joinSpectator());
if (btnOpenDashboard) btnOpenDashboard.addEventListener('click', openDashboardDemo);

inputRoom.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
if (inputSpectateRoom) inputSpectateRoom.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinSpectator(); });

btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(roomId).then(() => {
        btnCopy.textContent = '✅';
        setTimeout(() => btnCopy.textContent = '📋', 1500);
    });
});

btnPlayAgain.addEventListener('click', resetGame);
btnBackLobby.addEventListener('click', goBackToLobby);
if (btnLeaveHud) btnLeaveHud.addEventListener('click', goBackToLobby);

if (inputPieceCount && totalPiecesLabel) {
    inputPieceCount.addEventListener('input', () => {
        let val = parseInt(inputPieceCount.value) || 3;
        if (val < 3) val = 3;
        if (val > 36) val = 36;
        totalPiecesLabel.textContent = val;
    });
}

// Mobile Tabs
if (tabFocus && tabSide) {
    tabFocus.addEventListener('click', () => {
        tabFocus.classList.add('active');
        tabSide.classList.remove('active');
        focusArea.style.display = 'flex';
        sidePanel.style.display = 'none';
    });

    tabSide.addEventListener('click', () => {
        tabSide.classList.add('active');
        tabFocus.classList.remove('active');
        focusArea.style.display = 'none';
        sidePanel.style.display = 'flex';
    });
}

// Keyboard: Escape to deselect
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') deselectPiece();
});
