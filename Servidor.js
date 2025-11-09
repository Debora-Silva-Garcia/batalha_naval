const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// Estrutura de armazenamento das salas
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
      gameStarted: false,
    };
    roomJoined = newRoomId;
  }

  // Adiciona o jogador à sala
  socket.join(roomJoined);
  console.log(`Jogador ${socket.id} entrou na sala ${roomJoined}`);
  socket.emit("joinedRoom", roomJoined);

  // Verifica se sala está completa
  const room = rooms[roomJoined];
  if (room.players.length === 2) {
    room.gameStarted = true;
    io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    console.log(`Jogo iniciado na sala ${roomJoined}`);
  }

  // Quando um jogador desconecta
  socket.on("disconnect", () => {
    console.log("Jogador desconectado:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.indexOf(socket.id);

      if (index !== -1) {
        // Remove o jogador da sala
        room.players.splice(index, 1);
        io.to(roomId).emit("playerLeft", socket.id);

        // Remove a sala inteira (para evitar lixo e pareamento incorreto)
        delete rooms[roomId];
        console.log(`Sala ${roomId} removida devido à desconexão.`);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
