// Servidor.js (versão com permanentId)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

// Mapeamento permanentId -> socket.id (atual)
const playerSockets = {};

// ===== Função auxiliar =====
// Retorna roomId que contém o permanentId ou null
function getRoomByPlayer(permanentId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.includes(permanentId)) return roomId;
  }
  return null;
}

// assignToAvailableRoom: usa socket.permanentId (deve estar setado)
function assignToAvailableRoom(socket) {
  const permanentId = socket.permanentId;
  if (!permanentId) {
    console.warn("assignToAvailableRoom chamado sem permanentId");
    socket.emit("message", "Erro interno: permanentId não encontrado.");
    return;
  }

  // evita entrar duas vezes na mesma sala
  const already = getRoomByPlayer(permanentId);
  if (already) {
    socket.join(already);
    socket.emit("joinedRoom", already);
    console.log(`Jogador ${permanentId} já estava em ${already}, reconectado ao room.`);
    return;
  }

  let roomJoined = null;
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.length < 2) {
      room.players.push(permanentId);
      roomJoined = roomId;
      break;
    }
  }

  if (!roomJoined) {
    const newRoomId = `room-${permanentId}`;
    rooms[newRoomId] = {
      players: [permanentId],        // armazenamos permanentIds
      ships: {},                    // ships[permanentId] = [...]
      hitsAgainst: {},              // hitsAgainst[permanentId] = [...]
      turn: null,                   // permanentId que tem o turno
      gameStarted: false,
      lock: false,
      rematchVotes: null
    };
    roomJoined = newRoomId;
  }

  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);
  console.log(`Jogador ${permanentId} entrou na sala ${roomJoined}`);

  // atualiza mapeamento socket (importante)
  playerSockets[permanentId] = socket.id;

  const room = rooms[roomJoined];
  if (room.players.length === 2) {
    // apenas prepara a sala (não iniciar o jogo até ambos colocarem navios)
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    // informar quem terá o turno quando o jogo começar
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
    // envia yourTurn para o socket ativo (se conectado)
    const turnSocket = playerSockets[room.turn];
    if (turnSocket) io.to(turnSocket).emit("yourTurn");
  }
}

// ====== Conexão ======
io.on("connection", (socket) => {
  console.log("Novo socket conectado:", socket.id);

  // pega permanentId enviado pelo cliente (via io({ query: { permanentId } }))
  const permanentId = socket.handshake.query && socket.handshake.query.permanentId;
  if (!permanentId) {
    console.warn("Conexão sem permanentId. Rejeitando.");
    socket.emit("message", "Erro: permanentId ausente. Recarregue a página.");
    socket.disconnect(true);
    return;
  }

  // associa ao socket e ao mapa global
  socket.permanentId = permanentId;
  playerSockets[permanentId] = socket.id;

  console.log(`Conectado: permanentId=${permanentId} socket=${socket.id}`);

  // Verifica se o jogador já pertence a alguma sala (reconexão)
  const existingRoomId = getRoomByPlayer(permanentId);
  if (existingRoomId) {
    const room = rooms[existingRoomId];
    socket.join(existingRoomId);

    console.log(`🔌 Reconexão detectada: ${permanentId} entrou em ${existingRoomId} com socket ${socket.id}`);

    // Enviar estado completo da partida para o jogador reconectado
    const gameState = {
      ships: room.ships,
      hitsAgainst: room.hitsAgainst,
      turn: room.turn,
      players: room.players,
      gameStarted: room.gameStarted
    };

    socket.emit("restoreGameState", gameState);
    socket.emit("joinedRoom", existingRoomId);
    io.to(existingRoomId).emit("message", `Jogador ${permanentId} reconectou.`);
    io.to(existingRoomId).emit("turnUpdate", { turn: room.turn });

    // também notificar jogador cujo turno é atualmente (se conectado)
    const turnSocket = playerSockets[room.turn];
    if (turnSocket) io.to(turnSocket).emit("yourTurn");

    // já retornamos pois reconexão tratada
    return;
  }

  // Se não estava em sala, fazemos matchmaking normal
  assignToAvailableRoom(socket);

  // ===== Receber posições dos navios =====
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(permanentId);
    if (!roomId) return;
    const r = rooms[roomId];

    r.ships[permanentId] = ships;
    if (!Array.isArray(r.hitsAgainst[permanentId])) r.hitsAgainst[permanentId] = [];

    console.log(`Navios de ${permanentId} registrados em ${roomId}`);

    // Quando ambos tiverem enviado seus navios:
    // (verificamos se ambos players têm chave em r.ships)
    const readyCount = r.players.filter(pid => Array.isArray(r.ships[pid])).length;
    if (readyCount === 2) {
      // inicializa hitsAgainst para ambos (defensivo)
      for (const pid of r.players) {
        if (!Array.isArray(r.hitsAgainst[pid])) r.hitsAgainst[pid] = [];
      }

      // marca jogo iniciado
      r.gameStarted = true;
      // garantir turno (começa pelo primeiro jogador da sala)
      r.turn = r.turn || r.players[0];

      // Notifica clientes
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: r.turn });
      const turnSocket = playerSockets[r.turn];
      if (turnSocket) io.to(turnSocket).emit("yourTurn");

      console.log(`Sala ${roomId} pronta para jogar. Turno: ${r.turn}`);
    }
  });

  // ===== Receber ataque =====
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(permanentId);
    if (!roomId) return;
    const r = rooms[roomId];

    if (!r || !r.gameStarted) {
      socket.emit("message", "Partida não iniciada.");
      return;
    }

    if (r.lock) {
      socket.emit("message", "Aguarde processamento...");
      return;
    }
    r.lock = true;

    if (permanentId !== r.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      r.lock = false;
      return;
    }

    const opponentId = r.players.find((id) => id !== permanentId);
    if (!opponentId || !r.ships[opponentId]) {
      socket.emit("message", "Oponente não pronto.");
      r.lock = false;
      return;
    }

    if (!Array.isArray(r.hitsAgainst[opponentId])) r.hitsAgainst[opponentId] = [];

    const already = r.hitsAgainst[opponentId].some(
      (h) => h.x === x && h.y === y && h.by === permanentId
    );
    if (already) {
      socket.emit("message", "Você já atacou esse quadrado.");
      r.lock = false;
      return;
    }

    let hit = false;
    for (const ship of r.ships[opponentId]) {
      const { size, orientation, x: sx, y: sy } = ship;
      for (let i = 0; i < size; i++) {
        const posX = orientation === "horizontal" ? sx + i : sx;
        const posY = orientation === "vertical" ? sy + i : sy;
        if (posX === x && posY === y) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }

    r.hitsAgainst[opponentId].push({ x, y, result: hit ? "hit" : "miss", by: permanentId });

    // notifica resultado para ambos (attacker é permanentId)
    io.to(roomId).emit("attackResult", { attacker: permanentId, x, y, result: hit ? "hit" : "miss" });

    // Troca o turno (uma jogada por vez)
    r.turn = opponentId;
    io.to(roomId).emit("turnUpdate", { turn: r.turn });

    // notifica yourTurn no socket do próximo jogador (se conectado)
    const nextSocket = playerSockets[r.turn];
    if (nextSocket) io.to(nextSocket).emit("yourTurn");

    // Verifica vitória
    const opponentCells = (r.ships[opponentId] || []).flatMap((ship) => {
      const cells = [];
      for (let i = 0; i < ship.size; i++) {
        cells.push({
          x: ship.orientation === "horizontal" ? ship.x + i : ship.x,
          y: ship.orientation === "vertical" ? ship.y + i : ship.y,
        });
      }
      return cells;
    });

    const hitsSet = new Set();
    for (const h of r.hitsAgainst[opponentId]) {
      if (h.result !== "hit") continue;
      if (opponentCells.some((c) => c.x === h.x && c.y === h.y)) {
        hitsSet.add(`${h.x},${h.y}`);
      }
    }

    if (hitsSet.size >= opponentCells.length) {
      // avisa o vencedor: usamos permanentId
      io.to(roomId).emit("gameOverOptions", { winner: permanentId });
      console.log(`Sala ${roomId}: vencedor ${permanentId}`);
      // note: não deletamos room ainda — aguardamos rematch/newMatch
    }

    r.lock = false;
  });

  // ===== Revanche / Nova partida =====
  socket.on("rematchRequest", () => {
    const roomId = getRoomByPlayer(permanentId);
    if (!roomId) return;
    const room = rooms[roomId];

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(permanentId);

    if (room.rematchVotes.size === 2) {
      // reinicia estado da sala para nova partida com os mesmos permanentIds
      room.ships = {};
      room.hitsAgainst = {};
      room.turn = room.players[0];
      room.gameStarted = false; // volta a false até que ambos enviem placeShips
      room.lock = false;
      delete room.rematchVotes;

      io.to(roomId).emit("rematchStart");
      console.log(`Revanche iniciada na sala ${roomId}`);
    } else {
      socket.emit("message", "Aguardando o adversário aceitar a revanche...");
    }
  });

  socket.on("newMatchRequest", () => {
    const roomId = getRoomByPlayer(permanentId);
    if (!roomId) return;
    const room = rooms[roomId];

    // sai da sala atual e entra no matchmaking normal
    socket.leave(roomId);
    room.players = room.players.filter((id) => id !== permanentId);

    // informa ao(s) players que alguém saiu
    io.to(roomId).emit("playerLeft", permanentId);

    // se sobrar um jogador solo, delete a sala
    if (room.players.length === 1) {
      const remaining = room.players[0];
      // notifica o jogador restante que adversário saiu
      const remainingSocket = playerSockets[remaining];
      if (remainingSocket) io.to(remainingSocket).emit("message", "O adversário saiu. Você será realocado.");
      delete rooms[roomId];
      console.log(`Sala ${roomId} removida (novo jogo solicitado por ${permanentId}).`);
    } else if (room.players.length === 0) {
      delete rooms[roomId];
    }

    // reafiliamos o solicitante a matchmaking (com seu permanentId já setado no socket)
    assignToAvailableRoom(socket);
  });

  // ===== Desconexão =====
  socket.on("disconnect", () => {
    console.log("Socket desconectado:", socket.id, "permanentId:", permanentId);

    // marca socket como desconectado no playerSockets
    if (playerSockets[permanentId] === socket.id) {
      // remove mapping para indicar que o jogador está offline
      delete playerSockets[permanentId];
    }

    // notifica sala caso esteja presente (mas NÃO deletamos a sala)
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(permanentId);
      if (index !== -1) {
        io.to(roomId).emit("playerLeft", permanentId);
        console.log(`Jogador ${permanentId} desconectou da sala ${roomId}, aguardando reconexão.`);
        // não removemos o room — permitindo reconexão
        return;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
