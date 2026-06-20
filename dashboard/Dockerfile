FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm npm install

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
