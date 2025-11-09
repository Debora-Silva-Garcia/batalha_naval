const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = {};

io.on("connection", (socket) => {
  console.log("Novo jogador conectado:", socket.id);

  let roomJoined = null;

  // Encontrar ou criar sala
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
      ships: {},     // ships[playerId] = [ {x,y,size,orientation}, ... ]
      hits: {},      // hits[playerId] = [ {x,y,result} ] where key is attackerId
      turn: null,
      gameStarted: false,
      lock: false    // simples lock para evitar race conditions
    };
    roomJoined = newRoomId;
  }

  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);
  console.log(`Jogador ${socket.id} entrou na sala ${roomJoined}`);

  const room = rooms[roomJoined];

  // Se a sala estiver completa, iniciar jogo e enviar atualização de turno autoritativa
  if (room.players.length === 2) {
    room.gameStarted = true;
    room.turn = room.players[0];
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    // fonte de verdade do turno
    io.to(roomJoined).emit("turnUpdate", { turn: room.turn });
    console.log(`Jogo iniciado na sala ${roomJoined} - turno: ${room.turn}`);
  }

  // RECEBER POSIÇÕES DOS NAVIOS
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];
    r.ships[socket.id] = ships;
    r.hits[socket.id] = []; // inicializa hits do atacante
    console.log(`Navios de ${socket.id} registrados em ${roomId}`);

    if (Object.keys(r.ships).length === 2) {
      io.to(roomId).emit("readyToPlay");
      // garante que todos saibam quem é o jogador do turno
      io.to(roomId).emit("turnUpdate", { turn: r.turn });
      io.to(r.turn).emit("yourTurn"); // compatibilidade
    }
  });

  // RECEBER ATAQUE
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;
    const r = rooms[roomId];

    if (!r || !r.gameStarted) return;

    // lock simples para evitar processar >1 ataque simultâneo
    if (r.lock) {
      socket.emit("message", "Aguarde processamento...");
      return;
    }
    r.lock = true;

    // valida turno
    if (socket.id !== r.turn) {
      socket.emit("message", "⛔ Não é seu turno!");
      r.lock = false;
      return;
    }

    const opponentId = r.players.find((id) => id !== socket.id);
    if (!opponentId || !r.ships[opponentId]) {
      socket.emit("message", "Oponente não pronto ou ausente.");
      r.lock = false;
      return;
    }

    // assegura que há um array de ataques para este atacante
    if (!Array.isArray(r.hits[socket.id])) r.hits[socket.id] = [];

    // previne ataques duplicados: só considera ataques já feitos POR ESTE MESMO atacante
    const alreadyAttackedByMe = r.hits[socket.id].some(h => h.x === x && h.y === y);
    if (alreadyAttackedByMe) {
      socket.emit("message", "Você já atacou esse quadrado. Escolha outro.");
      r.lock = false;
      return;
    }


    let hit = false;

    // Verifica acerto
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

    // Registra hit/miss sob o atacante
    if (!Array.isArray(r.hits[socket.id])) r.hits[socket.id] = [];
    r.hits[socket.id].push({ x, y, result: hit ? "hit" : "miss" });

    // Envia resultado para ambos
    io.to(roomId).emit("attackResult", {
      attacker: socket.id,
      x,
      y,
      result: hit ? "hit" : "miss",
    });

    // --- HERE: trocar SEMPRE o turno (uma jogada por turno) ---
    r.turn = opponentId;

    // envia atualização autoritativa do turno para todos (fonte de verdade)
    io.to(roomId).emit("turnUpdate", { turn: r.turn });

    // verifica condição de vitória (todas as células do oponente atingidas)
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

    const hitsAgainstOpponent = Object.values(r.hits)
      .flat()
      .filter((h) => h.result === "hit" && opponentCells.some((c) => c.x === h.x && c.y === h.y));

    if (hitsAgainstOpponent.length >= opponentCells.length) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
      delete rooms[roomId];
      console.log(`Sala ${roomId} encerrada. Vencedor: ${socket.id}`);
    }

    r.lock = false;
  });


  // DISCONNECT
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

// Auxiliar
function getRoomByPlayer(playerId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.includes(playerId)) return roomId;
  }
  return null;
}

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
