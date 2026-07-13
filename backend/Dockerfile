FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Kolkata
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps first so this layer is cached between code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Single worker — the workload is I/O-bound and the machine has 256MB RAM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
