# Chrome Extension Project

Расширение для Google Chrome.

## Структура проекта

```
WebExtensions/
├── manifest.json      # Манифест расширения
├── popup.html         # HTML для popup окна
├── popup.css          # Стили для popup
├── popup.js           # JavaScript для popup
├── icons/             # Иконки расширения
└── README.md          # Этот файл
```

## Установка

1. Откройте Chrome и перейдите в `chrome://extensions/`
2. Включите "Режим разработчика" (Developer mode)
3. Нажмите "Загрузить распакованное расширение" (Load unpacked)
4. Выберите папку с проектом

## Разработка

- `manifest.json` - основной файл конфигурации расширения
- `popup.html/js/css` - файлы для popup окна расширения

## Иконки

Поместите иконки расширения в папку `icons/`:
- `icon16.png` - 16x16 пикселей
- `icon48.png` - 48x48 пикселей
- `icon128.png` - 128x128 пикселей

## Лицензия

MIT
