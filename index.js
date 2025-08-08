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

// refresh_token を使ってアクセストークンをセット
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

/**
 * 動作確認用
 */
app.get('/', (req, res) => {
  res.send('Google Drive Proxy Server is running.');
});

/**
 * ルートにファイルをアップロード
 */
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

/**
 * 指定フォルダにファイルをアップロード
 */
app.post('/upload-to-folder', upload.single('file'), async (req, res) => {
  try {
    const { folderId } = req.body;

    const fileMetadata = {
      name: req.file.originalname,
      parents: [folderId],
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
      message: '指定フォルダへのアップロード成功',
      file: response.data,
    });
  } catch (error) {
    console.error('フォルダアップロード失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * フォルダ作成と共有リンク付与
 */
app.post('/create-folder', async (req, res) => {
  try {
    const { name } = req.body;

    const fileMetadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id, name, webViewLink',
    });

    await drive.permissions.create({
      fileId: folder.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const updated = await drive.files.get({
      fileId: folder.data.id,
      fields: 'id, name, webViewLink',
    });

    res.json({
      message: 'フォルダ作成成功',
      folder: updated.data,
    });
  } catch (error) {
    console.error('フォルダ作成失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ファイルを別フォルダに移動
 */
app.post('/move-file', async (req, res) => {
  const { fileId, sourceFolderId, destinationFolderId } = req.body;

  try {
    const response = await drive.files.update({
      fileId,
      addParents: destinationFolderId,
      removeParents: sourceFolderId,
      fields: 'id, name, webViewLink, parents',
    });

    res.json({
      message: 'ファイル移動成功',
      file: response.data,
    });
  } catch (error) {
    console.error('ファイル移動失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 サーバー起動: http://localhost:${PORT}`);
});
