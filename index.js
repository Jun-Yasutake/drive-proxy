// ==============================
// Google Drive Proxy Server
// ==============================

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { google } = require('googleapis');
const { Readable } = require('stream');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// OAuth2 クライアントの設定
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// アクセストークンを設定
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// ==============================
// POST /upload → Google Drive にファイルアップロード
// ==============================
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const fileMetadata = {
      name: req.file.originalname,
    };

    const media = {
      mimeType: req.file.mimetype,
      body: Readable.from(req.file.buffer),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, name, webViewLink',
    });

    res.json({
      message: 'アップロード成功',
      file: response.data,
    });
  } catch (error) {
    console.error('アップロード失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST /create-folder → 新規フォルダを作成＋公開リンク設定
// ==============================
app.post('/create-folder', async (req, res) => {
  try {
    const { name } = req.body;

    // フォルダ作成
    const folderMetadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: 'id, name, webViewLink',
    });

    const folderId = folder.data.id;

    // 「リンクを知っている全員に公開」権限を付与
    await drive.permissions.create({
      fileId: folderId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    // webViewLink は元の folder.data に含まれる
    res.json({
      message: 'フォルダ作成成功',
      folder: folder.data,
    });
  } catch (error) {
    console.error('フォルダ作成失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// GET / → 動作確認用
// ==============================
app.get('/', (req, res) => {
  res.send('Google Drive Proxy Server is running.');
});

// ==============================
// サーバー起動
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 プロキシサーバーが起動しました: http://localhost:${PORT}`);
});
