FROM node:22-slim
WORKDIR /app
COPY package.json server.js index.html ./
ENV PORT=3100
EXPOSE 3100
USER node
CMD ["node", "server.js"]
