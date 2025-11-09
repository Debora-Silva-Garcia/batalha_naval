// Conecta ao servidor via WebSocket
const socket = io();

socket.on("connect", () => {
  console.log("Conectado ao servidor!");
});
