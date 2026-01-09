FROM node:20-alpine

WORKDIR /app

# 接收构建时参数（用于 HTTPS 地址）
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

COPY package*.json ./
RUN npm ci

# 复制所有文件（包括 .env.production）
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]

