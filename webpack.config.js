const webpack = require('webpack');
const path = require('path');

const thirdparty = path.resolve(__dirname, 'src', 'thirdparty');

module.exports = {
  mode: process.env.NODE_ENV || 'production',
  entry: {
    index: path.resolve(__dirname, 'index.js')
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  },
  resolve: {
    modules: ['node_modules'],
    extensions: ['.js'],
    alias: {
      lodash: 'underscore',
      Logger: path.join(thirdparty, 'Logger.js'),
      sdpUtils: path.join(thirdparty, 'sdp-utils.js'),
      state_machine: path.join(thirdparty, 'state_machine.js'),
      webrtcsupport: path.join(thirdparty, 'webrtc-support.js'),
      browserDetector: path.join(thirdparty, 'browserDetector.js')
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  node: {
    fs: 'empty'
  },
  optimization: {
		// We no not want to minimize our code.
		minimize: process.env.NODE_ENV === 'production'
	},
}