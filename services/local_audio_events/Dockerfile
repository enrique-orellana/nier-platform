FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/home/app \
    TF_CPP_MIN_LOG_LEVEL=2 \
    TF_USE_LEGACY_KERAS=1 \
    TF_NUM_INTRAOP_THREADS=1 \
    TF_NUM_INTEROP_THREADS=1 \
    OMP_NUM_THREADS=1

WORKDIR /app

RUN groupadd --system --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app

COPY requirements.txt ./requirements.txt
COPY requirements-model.txt ./requirements-model.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --no-deps -r requirements-model.txt

COPY --chown=app:app app ./app

RUN mkdir -p /home/app/.cache/tfhub_modules \
    && chown -R app:app /home/app/.cache

USER app
EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
