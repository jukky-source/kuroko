# 黒子(くろこ) — ずっと働くAIエージェント

iPhoneのホーム画面からアプリのように使えて、**完全無料(月0円)** で働き続けるAIエージェントです。
OpenAIの「dots」のような“常時稼働エージェント”を、GitHubの無料枠だけで再現します。

```
 iPhone(ホーム画面のアプリ)
   ├ 会話タブ …… 無料LLM(Pollinations / Gemini / Groq)と直接お話し
   └ 日報タブ …… 黒子がGitHub Actionsで働いた成果を読む
                          ↑
        GitHub Actions(公開リポジトリなら無料)
        毎日 朝7時・夜22時(日本時間)に自動で起床
        指示書(agent.json)とニュースRSSを読み → 日報を作り → 保存
```

| 部品 | 役割 | 料金 |
|---|---|---|
| GitHub Pages | アプリの体(ホスティング) | 0円(公開リポジトリ) |
| GitHub Actions | 黒子の労働(毎日の自律作業) | 0円(公開リポジトリ) |
| Pollinations | 頭脳(キー登録不要ですぐ動く) | 0円 |
| Gemini / Groq API(任意) | 頭脳のグレードアップ用 | 0円(カード不要の無料枠) |

---

## 最初にやることは、たった1つ

1. iPhoneのSafariでアプリのURLを開く
2. 「共有」→「**ホーム画面に追加**」→「追加」
3. ホームの「黒」アイコンから、普通のアプリのように起動

キー登録などの設定は不要です。すぐ話せます(頭脳はキー不要のPollinations)。

---

## 黒子の1日
- **朝7時** と **夜22時**(日本時間)に、GitHub Actionsの中で目を覚まします
- 指示書(`agent.json`)とニュースRSSを読み、**日報**を作って `data/daily/` に保存します
- アプリの「日報」タブを開くと読めます
- 手動で今すぐ働かせる:リポジトリの **Actions → 黒子の毎日の仕事 → Run workflow**

## 仕事を変えるには
リポジトリの **`agent.json`** をGitHubの画面から編集するだけ(次の勤務から反映)。
- `directives`: 毎日の仕事の内容(ニュース要約、競合調査、英単語クイズ、日記生成など自由に)
- `feeds`: 読み込むニュースRSS
- `persona`: 性格・口調

## 頭脳をグレードアップ(任意・無料)
アプリの「設定」タブで頭脳を選べます。
- **Pollinations**: キー不要。初期設定。
- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)でキー発行(無料・カード不要)→ 設定タブで入力。キーはiPhone内にのみ保存されます。
- **Groq**: [Groq Console](https://console.groq.com/keys)でキー発行(無料)。

日報を書く黒子の頭脳も強くしたい場合は、リポジトリの **Settings → Secrets and variables → Actions** に `GEMINI_API_KEY`(または `GROQ_API_KEY`)を登録。未登録でもPollinationsで働きます。

## 任意: 日報をスマホに通知する(Discord)
1. Discordのサーバー → チャンネル設定 →「連携サービス」→「ウェブフック」→ URLをコピー
2. Secret に `DISCORD_WEBHOOK` として登録
3. 次の勤務から、日報の冒頭がDiscordに届きます

## よくある質問
- **Actionsの予定時刻に動かない**: GitHubのcronは混雑時に最大30分ほど遅れます。仕様です。
- **429エラーが出る**: 無料枠の回数制限です。少し待つか、設定で頭脳を変えてください。
- **Secretsは公開リポジトリで見える?**: 見えません。暗号化され、Actionsの中でだけ使えます。APIキーをファイルに書くことだけはしないでください。
- **会話データはどこ?**: あなたのiPhone内(localStorage)だけ。設定タブから消せます。
- **黒子をやめさせる**: リポジトリを削除すれば、アプリも毎日の仕事もすべて消えます。

## 付録: 手動で公開する場合(すでに公開済みなら不要)
1. [github.com/new](https://github.com/new) で **Public** リポジトリ(例: `kuroko`)を作成
2. zipを展開し、「Add file → Upload files」で中身をすべて投入(`.github` フォルダも)
3. **Settings → Pages** で Branch: `main` / `/ (root)` をSave
4. 数分後 `https://(ユーザー名).github.io/kuroko/` が生きます

## トラブルシュート
| 症状 | 直し方 |
|---|---|
| 日報タブに「まだ働いていません」 | Actions → Run workflow を押す |
| Actionsが赤で失敗 | 失敗ログを確認。Pollinationsの一時エラーなら数分後に再Run |
| ホーム画面アイコンが白い | icon-*.png がリポジトリのルートにあるか確認 |
| モデル名エラー | 設定タブの「一覧取得」から選び直す |
