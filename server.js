const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let pitch = {
    width: 1100,
    height: 750,
    marginX: 400,
    marginY: 400,
    goalSide: 125,
};

let score = {
    home: 0,
    away: 0
};

let ball = {
    x: (pitch.width / 2) + pitch.marginX,
    y: (pitch.height / 2) + pitch.marginY,
    radius: 10,
    velocityX: 0,
    velocityY: 0,
    friction: 0.98,
    acceleration: 0.5,
    mass: 1,
    angle: 0,
    active: true,
    lastKick: null
};

const players = {};

const alignment = {
    home: [
        { x: pitch.marginX + 200, y: (pitch.height / 2) + pitch.marginY },
        { x: pitch.marginX + 300, y: (pitch.height / 2) + pitch.marginY - pitch.goalSide },
        { x: pitch.marginX + 300, y: (pitch.height / 2) + pitch.marginY + pitch.goalSide }
    ],
    away: [
        { x: pitch.marginX + pitch.width - 200, y: (pitch.height / 2) + pitch.marginY },
        { x: pitch.marginX + pitch.width - 300, y: (pitch.height / 2) + pitch.marginY - pitch.goalSide },
        { x: pitch.marginX + pitch.width - 300, y: (pitch.height / 2) + pitch.marginY + pitch.goalSide } 
    ]
};

const places = { home: [0, 1, 2], away: [0, 1, 2] };

io.on('connection', (socket) => {
    socket.on('playerData', (playerData) => {
        if (playerData === null) return socket.disconnect();
        
        if (places.home.length > 0 ||  places.away.length > 0) {
            const team = places.home.length >= places.away.length ? 'home' : 'away';
            const spawn = places[team].shift();

            players[socket.id] = {
                x: alignment[team][spawn].x,
                y: alignment[team][spawn].y,
                nickname: playerData.nickname,
                color: playerData.color,
                radius: 20,
                mass: 2,
                range: 10,
                team: team,
                spawn: spawn
            };
        } else {
            players[socket.id] = {
                nickname: playerData.nickname,
                color: playerData.color,
            };
        }

        socket.on("ping", callback => callback());

        io.emit('chat', { entity: players[socket.id], content: { type: 'connection', connected: true } });
        socket.emit('update', { players, ball, score });
        socket.broadcast.emit('update', { players, ball, score });
    
        socket.on('chat', (data) => {
            io.emit('chat', { entity: players[socket.id], content: data });
        });

        socket.on('move', (data) => {
            const player = players[socket.id];
            player.x += Math.cos(data.direction) * data.speed;
            player.y += Math.sin(data.direction) * data.speed;
    
            io.emit('update', { players, ball, score });
        });
    
        socket.on('kick', () => {
            const player = players[socket.id];
            const distanceToBall = distanceBetween(player.x, player.y, ball.x, ball.y);
            const detectionRange = player.radius + ball.radius + player.range;

            if (distanceToBall <= detectionRange) {
                const angle = Math.atan2(ball.y - player.y, ball.x - player.x);
                const kickForce = 10;
                
                ball.velocityX += Math.cos(angle) * kickForce;
                ball.velocityY += Math.sin(angle) * kickForce;
    
                ball.lastKick = player;
    
                io.emit('update', { players, ball, score });
            }
        });
    
        socket.on('disconnect', () => {
            const player = players[socket.id];
    
            if (player.team) places[player.team].push(player.spawn);
            
            delete players[socket.id];
    
            io.emit('update', { players, ball, score });
            io.emit('chat', { entity: player, content: { type: 'connection', connected: false } });
        });
    });
});

function distanceBetween(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function isCollidingCircle(x1, y1, radius1, x2, y2, radius2) {
    const distance = distanceBetween(x1, y1, x2, y2);
    return distance < radius1 + radius2;
}

function resolveCollision(x1, y1, radius1, x2, y2, radius2, mass1, mass2) {
    const distance = distanceBetween(x1, y1, x2, y2);

    if (distance < radius1 + radius2) {
        const overlap = radius1 + radius2 - distance;
        const angle = Math.atan2(y2 - y1, x2 - x1);

        const force = (mass1 + mass2) / 2;
        const correctionFactor = 0.5;

        return {
            x: Math.cos(angle) * overlap * force * correctionFactor,
            y: Math.sin(angle) * overlap * force * correctionFactor
        };
    }

    return { x: 0, y: 0 };
}

function updateBallPhysics() {
    ball.x += ball.velocityX;
    ball.y += ball.velocityY;

    ball.velocityX *= ball.friction;
    ball.velocityY *= ball.friction;

    ball.angle += Math.sqrt(ball.velocityX**2 + ball.velocityY**2) / ball.radius * (ball.velocityX >= 0 ? 1 : -1);

    if (ball.x + ball.radius > pitch.width + pitch.marginX) {
        if (ball.y - ball.radius > (pitch.height / 2) + pitch.marginY - pitch.goalSide && ball.y + ball.radius < (pitch.height / 2) + pitch.marginY + pitch.goalSide) {
            if (ball.x + ball.radius > pitch.width + pitch.marginX + (ball.radius * 2)) {
                goalEvent("home");
            }

            if (ball.x + ball.radius > pitch.width + pitch.marginX + 85) {
                ball.x = pitch.width + pitch.marginX + 85 - ball.radius;
                ball.velocityX *= -0.5;
            }

            if (ball.y - ball.radius < (pitch.height / 2) + pitch.marginY - pitch.goalSide) {
                ball.y = (pitch.height / 2) + pitch.marginY - pitch.goalSide + ball.radius;
                ball.velocityY *= -0.5;
            }
            
            if (ball.y + ball.radius > (pitch.height / 2) + pitch.marginY + pitch.goalSide) {
                ball.y = (pitch.height / 2) + pitch.marginY + pitch.goalSide - ball.radius;
                ball.velocityY *= -0.5;
            }
        } else {
            ball.x = pitch.width + pitch.marginX - ball.radius;
            ball.velocityX *= -0.5;
        }
    }

    if (ball.x - ball.radius < pitch.marginX) {
        if (ball.y - ball.radius > (pitch.height / 2) + pitch.marginY - pitch.goalSide && ball.y + ball.radius < (pitch.height / 2) + pitch.marginY + pitch.goalSide) {
            if (ball.x - ball.radius < pitch.marginX - (ball.radius * 2)) {
                goalEvent("away");
            }

            if (ball.x - ball.radius < pitch.marginX - 85) {
                ball.x = pitch.marginX - 85 + ball.radius;
                ball.velocityX *= -0.5;
            }

            if (ball.y - ball.radius < (pitch.height / 2) + pitch.marginY - pitch.goalSide) {
                ball.y = (pitch.height / 2) + pitch.marginY - pitch.goalSide + ball.radius;
                ball.velocityY *= -0.5;
            }
            
            if (ball.y + ball.radius > (pitch.height / 2) + pitch.marginY + pitch.goalSide) {
                ball.y = (pitch.height / 2) + pitch.marginY + pitch.goalSide - ball.radius;
                ball.velocityY *= -0.5;
            }
        } else {
            ball.x = pitch.marginX + ball.radius;
            ball.velocityX *= -0.5;
        }
    }

    if (ball.y + ball.radius > pitch.height + pitch.marginY) {
        ball.y = pitch.height + pitch.marginY - ball.radius;
        ball.velocityY *= -0.5;
    }

    if (ball.y - ball.radius < pitch.marginY) {
        ball.y = pitch.marginY + ball.radius;
        ball.velocityY *= -0.5;
    }
}

function goalEvent(team) {
    if (ball.active) {
        ball.active = false;
        score[team] = score[team] + 1;
        io.emit('goal', { team: team, author: ball.lastKick });
        
        setTimeout(() => {
            ball.x = (pitch.width / 2) + pitch.marginX;
            ball.y = (pitch.height / 2) + pitch.marginY;
            ball.velocityX = 0;
            ball.velocityY = 0;

            for (const id in players) {
                if (players[id].team) {
                    players[id].x = alignment[players[id].team][players[id].spawn].x;
                    players[id].y = alignment[players[id].team][players[id].spawn].y;
                }
            };

            if (score[team] === 5) {
                score.home = 0;
                score.away = 0;
            }
            
            ball.active = true;
        }, 2000);
    }
}

function updatePhysics() {
    updateBallPhysics();

    Object.keys(players).forEach((id1) => {
        const player1 = players[id1];
        Object.keys(players).forEach((id2) => {
            if (id1 !== id2) {
                const player2 = players[id2];
                if (isCollidingCircle(player1.x, player1.y, player1.radius, player2.x, player2.y, player2.radius)) {
                    const { x, y } = resolveCollision(player1.x, player1.y, player1.radius, player2.x, player2.y, player2.radius, player1.mass, player2.mass);
                    player1.x -= x;
                    player1.y -= y;
                    player2.x += x;
                    player2.y += y;
                }
            }
        });

        if (isCollidingCircle(player1.x, player1.y, player1.radius, ball.x, ball.y, ball.radius)) {
            const { x, y } = resolveCollision(player1.x, player1.y, player1.radius, ball.x, ball.y, ball.radius, player1.mass, ball.mass);
            ball.x += x;
            ball.y += y;
            const angle = Math.atan2(y, x);
            ball.velocityX += Math.cos(angle) * ball.acceleration;
            ball.velocityY += Math.sin(angle) * ball.acceleration;

            player1.x -= x / 2;
            player1.y -= y / 2;
        }
    });
}

function gameLoop() {
    updatePhysics();
    io.emit('update', { players, ball, score });
}

setInterval(gameLoop, 1000 / 60);

server.listen(3000, () => {
    console.log('Server is running...');
});