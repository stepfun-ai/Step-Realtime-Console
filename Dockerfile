FROM oven/bun:1 as BASE
WORKDIR /app

COPY . .
RUN bun install
RUN bun run build

# web server port
EXPOSE 3000/tcp

# WebSocket port
EXPOSE 8080/tcp

ENTRYPOINT ["bun", "--bun", "build/"]
