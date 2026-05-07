const mongoose = require("mongoose");
const Schema = mongoose.Schema;

let pageSchema = Schema({
  url: { type: String, unique: true },
  pageNum: {type: Number, default: -1},
  incomingUrls: {
    type: [{type: String}],
    default: []
  },
  outgoingUrls: {
    type: [{type: String}],
    default: []
  },
  incomingCount: {type: Number, default: 0},
  outgoingCount: {type: Number, default: 0},
  title: {type: String},
  body: {type: String},
  pageRank: {
    type: Number,
    default: null
  }
});

const FruitPage = mongoose.model('FruitPage', pageSchema);
const PersonalPage = mongoose.model('PersonalPage', pageSchema);

module.exports = {
  FruitPage,
  PersonalPage
};