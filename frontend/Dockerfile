FROM node:20-alpine

WORKDIR /app

# 使用淘宝npm镜像
RUN npm config set registry https://registry.npmmirror.com

# 先复制 package.json
COPY package*.json ./
RUN npm ci

# 复制所有文件（包括 .env.production）
COPY . .

# 设置环境变量（如果需要）
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

# 构建（使用构建时的环境变量）
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]

