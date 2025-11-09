const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

// ===== Função auxiliar =====
function getRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.includes(playerId)) return roomId;
  }
  return null;
}

function assignToAvailableRoom(socket) {
  let roomJoined = null;
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.length < 2) {
      room.players.push(socket.id);
      roomJoined = roomId;
      break;
    }
  }

  if (!roomJoined) {
    const newRoomId = `room-${socket.id}`;
    rooms[newRoomId] = {
      players: [socket.id],
      ships: {},
      hitsAgainst: {},
      turn: null,
      gameStarted: false,
      lock: false
    };
    roomJoined = newRoomId;
  }

  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);
  console.log(`Jogador ${socket.id} entrou na sala ${roomJoined}`);

  const room = rooms[roomJoined];
  if (room.players.length === 2) {
    // apenas prepara a sala (não iniciar o jogo até ambos colocarem navios)
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    // informar quem terá o turno quando o jogo começar
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
  }
}

// ====== Conexão ======
io.on("connection", (socket) => {
  console.log("Novo jogador conectado:", socket.id);

  assignToAvailableRoom(socket);

  // ===== Receber posições dos navios =====
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    r.ships[socket.id] = ships;
    if (!Array.isArray(r.hitsAgainst[socket.id])) r.hitsAgainst[socket.id] = [];

    console.log(`Navios de ${socket.id} registrados em ${roomId}`);

    // Quando ambos tiverem enviado seus navios:
    if (Object.keys(r.ships).length === 2) {
      // inicializa hitsAgainst para ambos (defensivo)
      for (const pid of r.players) {
        if (!Array.isArray(r.hitsAgainst[pid])) r.hitsAgainst[pid] = [];
      }

      // ------ CORREÇÃO IMPORTANTE ------
      // Agora sim marcamos o jogo como iniciado — assim o servidor aceitará ataques.
      r.gameStarted = true;
      // garantir turno (começa pelo primeiro jogador da sala)
      r.turn = r.turn || r.players[0];

      // Notifica clientes
      io.to(roomId).emit("readyToPlay");
      io.to(roomId).emit("turnUpdate", { turn: r.turn });
      io.to(r.turn).emit("yourTurn"); // compatibilidade/UX
      console.log(`Sala ${roomId} pronta para jogar. Turno: ${r.turn}`);
    }
  });

  // ===== Receber ataque =====
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
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

    if (socket.id !== r.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      r.lock = false;
      return;
    }

    const opponentId = r.players.find((id) => id !== socket.id);
    if (!opponentId || !r.ships[opponentId]) {
      socket.emit("message", "Oponente não pronto.");
      r.lock = false;
      return;
    }

    if (!Array.isArray(r.hitsAgainst[opponentId])) r.hitsAgainst[opponentId] = [];

    const already = r.hitsAgainst[opponentId].some(
      (h) => h.x === x && h.y === y && h.by === socket.id
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

    r.hitsAgainst[opponentId].push({ x, y, result: hit ? "hit" : "miss", by: socket.id });

    io.to(roomId).emit("attackResult", { attacker: socket.id, x, y, result: hit ? "hit" : "miss" });

    // Troca o turno (uma jogada por vez)
    r.turn = opponentId;
    io.to(roomId).emit("turnUpdate", { turn: r.turn });

    // Verifica vitória
    const opponentCells = r.ships[opponentId].flatMap((ship) => {
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
      // em vez de deletar imediatamente, avisamos com opções e aguardamos decisão dos jogadores
      io.to(roomId).emit("gameOverOptions", { winner: socket.id });
      console.log(`Sala ${roomId}: vencedor ${socket.id}`);
      // note: não deletamos room ainda — aguardamos rematch/newMatch
    }

    r.lock = false;
  });

  // ===== Revanche / Nova partida =====
  socket.on("rematchRequest", () => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.id);

    if (room.rematchVotes.size === 2) {
      // reinicia estado da sala para nova partida com os mesmos jogadores
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
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    // sai da sala atual e entra no matchmaking normal
    socket.leave(roomId);
    room.players = room.players.filter((id) => id !== socket.id);
    // se sobrar um jogador solo, informe e limpe a sala
    if (room.players.length === 1) {
      const remaining = room.players[0];
      io.to(roomId).emit("playerLeft", socket.id);
      // se desejar manter o jogador sozinho em sala para esperar, não delete. Aqui optamos por remover a sala.
      delete rooms[roomId];
    } else if (room.players.length === 0) {
      delete rooms[roomId];
    }

    assignToAvailableRoom(socket);
  });

  // ===== Desconexão =====
  socket.on("disconnect", () => {
    console.log("Jogador desconectado:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);
      if (index !== -1) {
        io.to(roomId).emit("playerLeft", socket.id);
        delete rooms[roomId];
        console.log(`Sala ${roomId} removida.`);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
