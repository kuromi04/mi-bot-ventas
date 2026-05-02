module.exports = {
  apps : [{
    name: "mi-bot-ventas",
    script: "./index.js",
    watch: false,
    env: {
      NODE_ENV: "production",
    },
    node_args: "--max-old-space-size=512",
    error_file: "./logs/err.log",
    out_file: "./logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
}
