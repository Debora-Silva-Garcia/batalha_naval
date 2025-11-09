// Importa módulos necessários
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// Cria app e servidor
const app = express();
const server = http.createServer(app);
const rooms = {}; // Armazena as salas e seus jogadores
const io = new Server(server);

// Servir arquivos estáticos da pasta "public" (cliente)
app.use(express.static("public"));

// Quando um cliente se conecta
io.on("connection", (socket) => {
  console.log("Novo jogador conectado!");
  socket.on("joinGame", () => { 
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
      rooms[newRoomId] = { players: [socket.id], gameStarted: false };
      roomJoined = newRoomId;
    }

    socket.join(roomJoined);
    socket.emit("joinedRoom", roomJoined);

    const room = rooms[roomJoined];
    if (room.players.length === 2) {
      room.gameStarted = true;
      io.to(roomJoined).emit("startGame", { roomId: roomJoined });
    }
    
  });
  socket.on("placeShips", (ships) => { /* salvar posições */ });
  socket.on("fire", (target) => { /* processar ataque */ });

  socket.on("disconnect", () => {
    console.log("Jogador desconectado.");
  });
});

// Inicia servidor na porta 3000
server.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});
