FROM python:3.11-slim
WORKDIR /app

# Install system deps for OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr libpq5 gcc \
    && rm -rf /var/lib/apt/lists/*

# Install service-specific deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY app.py fhir_builder.py ./

# Copy shared ACOS modules (mounted at runtime via volume in docker-compose)
# The OCR engine is imported lazily from /app/services/ocr_service

RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
