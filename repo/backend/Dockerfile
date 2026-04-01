FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache mysql-client

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["npm", "run", "start"]
