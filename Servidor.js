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

  // Tenta encontrar sala com menos de 2 jogadores
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.players.length < 2) {
      room.players.push(socket.id);
      roomJoined = roomId;
      break;
    }
  }

  // Se não achou, cria nova sala
  if (!roomJoined) {
    const newRoomId = `room-${socket.id}`;
    rooms[newRoomId] = {
      players: [socket.id],
      ships: {},
      hits: {},
      turn: null,
      gameStarted: false,
    };
    roomJoined = newRoomId;
  }

  // Adiciona jogador à sala
  socket.join(roomJoined);
  socket.emit("joinedRoom", roomJoined);
  console.log(`Jogador ${socket.id} entrou na sala ${roomJoined}`);

  const room = rooms[roomJoined];

  if (room.players.length === 2) {
    room.gameStarted = true;
    room.turn = room.players[0]; // primeiro jogador começa
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    console.log(`Jogo iniciado na sala ${roomJoined}`);
  }

  // ===== Receber as posições dos navios =====
  socket.on("placeShips", (ships) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;

    const room = rooms[roomId];
    room.ships[socket.id] = ships;
    room.hits[socket.id] = [];

    console.log(`Navios do jogador ${socket.id} registrados na sala ${roomId}`);

    // Se ambos enviaram as embarcações, começa o jogo
    if (Object.keys(room.ships).length === 2) {
      io.to(roomId).emit("readyToPlay");
      io.to(room.turn).emit("yourTurn");
    }
  });

  // ===== Receber um ataque =====
  socket.on("attack", ({ x, y }) => {
    const roomId = getRoomByPlayer(socket.id);
    if (!roomId) return;

    const room = rooms[roomId];
    if (socket.id !== room.turn) return; // não é o turno desse jogador

    const opponentId = room.players.find((id) => id !== socket.id);
    const opponentShips = room.ships[opponentId];

    let hit = false;

    // Verifica se o tiro acertou alguma embarcação
    for (const ship of opponentShips) {
      const { size, orientation, x: sx, y: sy } = ship;
      for (let i = 0; i < size; i++) {
        const posX = orientation === "horizontal" ? sx + i : sx;
        const posY = orientation === "vertical" ? sy + i : sy;
        if (posX === x && posY === y) {
          hit = true;
          room.hits[socket.id].push({ x, y, result: "hit" });
          break;
        }
      }
      if (hit) break;
    }

    if (!hit) {
      room.hits[socket.id].push({ x, y, result: "miss" });
    }

    // Envia resultado para ambos os jogadores
    io.to(roomId).emit("attackResult", {
      attacker: socket.id,
      x,
      y,
      result: hit ? "hit" : "miss",
    });

    // Troca o turno apenas se errou
    if (!hit) {
      room.turn = opponentId;
      io.to(room.turn).emit("yourTurn");
    }

    // Verifica se o jogo terminou (todas as partes dos navios destruídas)
    const opponentCells = opponentShips.flatMap((ship) => {
      const cells = [];
      for (let i = 0; i < ship.size; i++) {
        cells.push({
          x: ship.orientation === "horizontal" ? ship.x + i : ship.x,
          y: ship.orientation === "vertical" ? ship.y + i : ship.y,
        });
      }
      return cells;
    });

    const hitsByAttacker = room.hits[socket.id].filter((h) => h.result === "hit");
    if (hitsByAttacker.length >= opponentCells.length) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
      delete rooms[roomId];
      console.log(`Sala ${roomId} encerrada. Vencedor: ${socket.id}`);
    }
  });

  // ===== Quando o jogador desconecta =====
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

// ===== Função auxiliar =====
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
