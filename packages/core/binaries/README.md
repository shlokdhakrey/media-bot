# Binaries Folder

This folder contains platform-specific binaries for media-bot.

## Structure

```
binaries/
├── windows/
│   ├── ffmpeg.exe
│   ├── ffprobe.exe
│   ├── mkvmerge.exe
│   ├── mkvextract.exe
│   ├── mediainfo.exe
│   ├── rclone.exe
│   ├── aria2c.exe
│   ├── alass.exe
│   └── subsync.exe
├── linux/
│   ├── ffmpeg
│   ├── ffprobe
│   ├── mkvmerge
│   ├── mkvextract
│   ├── mediainfo
│   ├── rclone
│   ├── aria2c
│   ├── alass
│   └── subsync
└── macos/
    └── (same as linux)
```

## Priority Order

The system looks for binaries in this order:

1. **Environment Variables** - e.g., `FFMPEG_PATH=/custom/path/ffmpeg`
2. **This Folder** - `packages/core/binaries/{os}/`
3. **System PATH** - Default system installation

## Supported Binaries

| Binary | Description | Download |
|--------|-------------|----------|
| ffmpeg | Media processing | https://ffmpeg.org/download.html |
| ffprobe | Media analysis | (included with ffmpeg) |
| mkvmerge | MKV muxing | https://mkvtoolnix.download/ |
| mkvextract | MKV extraction | (included with mkvtoolnix) |
| mediainfo | Media info extraction | https://mediaarea.net/MediaInfo |
| rclone | Cloud storage sync | https://rclone.org/downloads/ |
| aria2c | Multi-protocol downloader | https://aria2.github.io/ |
| alass | Audio/subtitle sync | https://github.com/kaegi/alass |
| subsync | Subtitle synchronization | https://github.com/sc0ty/subsync |

## Environment Variables

You can override any binary path via environment variables in `.env`:

```env
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
MKVMERGE_PATH=C:\mkvtoolnix\mkvmerge.exe
MKVEXTRACT_PATH=C:\mkvtoolnix\mkvextract.exe
MEDIAINFO_PATH=C:\MediaInfo\mediainfo.exe
RCLONE_PATH=C:\rclone\rclone.exe
ARIA2C_PATH=C:\aria2\aria2c.exe
ALASS_PATH=C:\alass\alass.exe
SUBSYNC_PATH=C:\subsync\subsync.exe
```

## Windows Setup

1. Download each binary from the links above
2. Place the `.exe` files in `packages/core/binaries/windows/`
3. Or set environment variables in `.env`

## Linux Setup

1. Install via package manager or download binaries
2. Place in `packages/core/binaries/linux/`
3. Make executable: `chmod +x packages/core/binaries/linux/*`
4. Or set environment variables in `.env`

## Notes

- Binaries in this folder take precedence over system PATH
- Environment variables take highest precedence
- The system auto-detects OS and uses the correct subfolder
- Git ignores actual binary files (only README is tracked)
