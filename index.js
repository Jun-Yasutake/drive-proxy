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

// refresh_token を使ってアクセストークンをセット
oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

// Google Drive API のインスタンス
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// ==============================
// GET / → 動作確認
// ==============================
app.get('/', (req, res) => {
  res.send('Google Drive Proxy Server is running.');
});

// ==============================
// POST /upload → ルート直下にアップロード
// ==============================
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const fileMetadata = { name: req.file.originalname };
    const media = {
      mimeType: req.file.mimetype,
      body: Readable.from(req.file.buffer),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, name, webViewLink',
    });

    res.json({ message: 'アップロード成功', file: response.data });
  } catch (error) {
    console.error('アップロード失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST /upload-to-folder → 指定フォルダへアップロード
// (multipart/form-data: file, folderId)
// ==============================
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
      fields: 'id, name, webViewLink, parents',
    });

    res.json({ message: '指定フォルダへのアップロード成功', file: response.data });
  } catch (error) {
    console.error('フォルダアップロード失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST /create-folder → 単体フォルダ作成（任意公開）
// Body: { name: string, makePublic?: boolean }
// ==============================
app.post('/create-folder', async (req, res) => {
  try {
    const { name, makePublic = false } = req.body;

    const folder = await drive.files.create({
      resource: { name, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id, name, webViewLink',
    });

    const folderId = folder.data.id;

    if (makePublic) {
      await drive.permissions.create({
        fileId: folderId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    }

    // 共有設定直後の最新リンクを取得
    const updated = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, webViewLink',
    });

    res.json({ message: 'フォルダ作成成功', folder: updated.data });
  } catch (error) {
    console.error('フォルダ作成失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST /move-file → ファイルを別フォルダへ移動
// Body: { fileId, sourceFolderId, destinationFolderId }
// ==============================
app.post('/move-file', async (req, res) => {
  try {
    const { fileId, sourceFolderId, destinationFolderId } = req.body;

    const response = await drive.files.update({
      fileId,
      addParents: destinationFolderId,
      removeParents: sourceFolderId,
      fields: 'id, name, parents, webViewLink',
    });

    res.json({ message: 'ファイル移動成功', file: response.data });
  } catch (error) {
    console.error('ファイル移動失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// POST /create-template-folders → テンプレート一括作成
// Body: { rootName: string, makePublic?: boolean }
// 生成: ルート(rootName) / フォルダA / フォルダB / フォルダC
// ==============================
app.post('/create-template-folders', async (req, res) => {
  try {
    const { rootName, makePublic = false } = req.body;
    if (!rootName || typeof rootName !== 'string') {
      return res.status(400).json({ error: 'rootName は必須です' });
    }

    // 1) ルート作成
    const root = await drive.files.create({
      resource: { name: rootName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id, name, webViewLink',
    });
    const rootId = root.data.id;

    // 2) 子フォルダ作成（A/B/C）
    const childrenNames = ['フォルダA', 'フォルダB', 'フォルダC'];
    const childrenCreated = await Promise.all(
      childrenNames.map((name) =>
        drive.files.create({
          resource: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [rootId],
          },
          fields: 'id, name, webViewLink, parents',
        })
      )
    );

    // 3) 公開設定（任意）：root と子フォルダすべてに付与
    if (makePublic) {
      const allIds = [rootId, ...childrenCreated.map((c) => c.data.id)];
      await Promise.all(
        allIds.map((fileId) =>
          drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' },
          })
        )
      );
    }

    // 4) 最新リンクを取得（webViewLink を確実に反映）
    const [rootInfo, ...childrenInfo] = await Promise.all([
      drive.files.get({ fileId: rootId, fields: 'id, name, webViewLink' }),
      ...childrenCreated.map((c) =>
        drive.files.get({ fileId: c.data.id, fields: 'id, name, webViewLink, parents' })
      ),
    ]);

    res.json({
      message: 'テンプレート作成成功',
      root: rootInfo.data,
      children: childrenInfo.map((r) => r.data),
    });
  } catch (error) {
    console.error('テンプレート作成失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==============================
// サーバー起動
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 サーバー起動: http://localhost:${PORT}`);
});
