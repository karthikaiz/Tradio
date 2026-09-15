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

# Bake the NSE-equity slice of Angel's scrip master into the image.
#
# The full master is ~25MB on the wire and ~98MB once parsed in bulk. Doing
# that on the 256MB production machine is what caused the recurring
# "Instruments master still loading" outage. Here there is memory to spare,
# and the result is a 41KB file the app reads instantly with no network.
#
# Non-fatal: a blip on the build host must not block a deploy, and the app
# still has its (now streamed) runtime download to fall back on.
RUN python scripts/fetch_instruments.py || true

# Single worker — the workload is I/O-bound and the machine has 256MB RAM
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
