# Кадры для анимации первого экрана

Цель: заменить нарисованного водителя в сцене `index.html` на фотореалистичные кадры,
сгенерированные Seedream по фото владельца, и собрать из них анимацию.

## Что нужно в среде

- Ключ Seedream одним из способов:
  - API credential в настройках облачной среды (тип Bearer, хост `ark.ap-southeast.bytepluses.com`):
    ключ подставляет прокси, доступ к хосту открывается сам, `ARK_API_KEY` не нужен;
  - или переменная окружения `ARK_API_KEY` плюс хост в Network access → Custom → Allowed domains.
- Хост API: `ark.ap-southeast.bytepluses.com` (BytePlus) или `ark.cn-beijing.volces.com` (Volcengine).
  Для Volcengine также задать `ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`
  и `SEEDREAM_MODEL=doubao-seedream-4-0-250828`.
- Фото лица в `ando-site/tools/ref/` (папка в `.gitignore`, в репозиторий не коммитить).

## Генерация

```
cd ando-site/tools
python3 seedream_frames.py start --face ref/face1.jpg --face ref/face2.jpg
# выбрать master-N с самым похожим лицом
python3 seedream_frames.py finish --master ../assets/raw/master-N.jpg --light
```

Результат в `ando-site/assets/raw/` (тоже в `.gitignore`): `wide`, `wheel`, `master-1..4`,
`window-closed`, `smile`, `money` и версии `*-light`.

## Сборка анимации (следующий шаг)

Сценарий как в текущей SVG-сцене, но на фото:

1. `wheel`: колесо вырезать кругом отдельным слоем, крутить и двигать вместе с кузовом, торможение с клевком.
2. Переход к `wide`: отъезд камеры до всей машины, включаются фары.
3. Переход к окну: `window-closed` → стекло опускается (`master`), блик скользит по стеклу.
4. `master` → `smile`: плавный переход, лёгкий кивок, отблеск по черным линзам очков.
5. `money`: рука с деньгами выходит навстречу зрителю с небольшим увеличением.
6. Финальный кадр с микродвижением. Для `prefers-reduced-motion` показать только его.

Кадры сжать в WebP/AVIF (общий вес 0,5–1 МБ), для светлой темы брать `*-light`.
Итоговые сжатые кадры класть в `ando-site/assets/` и коммитить.
