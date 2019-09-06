const TeleBot = require('telebot');
require('dotenv').config();
const requests = require("axios");
const t = require("typy").t;
const sleep = require('system-sleep');
const crypto = require('crypto');
const fs = require("fs");
const bitcoin = require('bitcoinjs-lib')

const network = bitcoin.networks[process.env.NETWORK];
const bot = new TeleBot(process.env.TELEGRAM_TOKEN);

const wallets = {};

const satushi = 100000000;

var feePerSatushi = 25;
function createWallet(dialogId) {
    const keyPair = bitcoin.ECPair.makeRandom(network);
    const { address } = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: network });
    wallets[dialogId] = {addr:address, wif: keyPair.toWIF()};
    fs.writeFile(`data/${dialogId}_wallet.json`,
            JSON.stringify(wallets[dialogId]), function (err) {
        if (err) {
            return console.log(err, wallets[dialogId]);
        }

        console.log(`The wallet was saved!`);
        // msg.reply.text("your wallet is now backed up on our servers!");
    });
    fs.writeFile(`data/all_wallet.json`,
            JSON.stringify(wallets), function (err) {
        if (err) {
            return console.log(err, wallets[dialogId]);
        }

        console.log(`The global wallet was saved!`);
    });
    wallets[dialogId].pkey = keyPair;
    return address;
}

function loadWallet(dialogId) {
    if(wallets[dialogId]) return wallets[dialogId];
    var path = `data/${dialogId}_wallet.json`;
    if(fs.existsSync(path)) {
        wallets[dialogId] = JSON.parse(fs.readFileSync(path));
        wallets[dialogId].pkey = bitcoin.ECPair.fromWIF(wallets[dialogId].wif);
        wallets[dialogId].pkey.network = network;
        return wallets[dialogId];
    }
    return;
}

function balance(dialogId, msg) {
    var wallet = loadWallet(dialogId);
    if(!wallet) {
        msg.reply.text("Can't recognize you!\nDid you change your number recently?");
        return;
    }
    requests.get(`https://blockstream.info/testnet/api/address/${wallet.addr}`).then((res) => {
        // console.log(res.data);
        msg.reply.text(`Your balance is ${(res.data.chain_stats.funded_txo_sum-res.data.chain_stats.spent_txo_sum)/satushi}BTC`);
        if(res.data.mempool_stats.funded_txo_sum !== 0) {
            msg.reply.text(`You have ${res.data.mempool_stats.funded_txo_sum/satushi}BTC in non confirmed transactions`);
        }
        if(res.data.mempool_stats.spent_txo_sum !== 0) {
            msg.reply.text(`You spent ${res.data.mempool_stats.spent_txo_sum/satushi}BTC in non confirmed transactions`);
        }
    }).catch((err) => {
        console.log(err);
        msg.reply.text(`Failed to get your balance: ${err}`);
    });
}

function pay(dialogId, msg, text) {
    var wallet = loadWallet(dialogId);
    if(!wallet) {
        msg.reply.text("Can't recognize you!\nDid you change your number recently?");
        return;
    }
    var brokenText = text.split(" ");
    if(brokenText.length < 2) {
        msg.reply.text("Please specify target address and amount of BTC");
        return;
    }
    var target = brokenText[1];
    var amount = Number(brokenText[2]) * satushi;
    requests.get(`https://blockstream.info/testnet/api/address/${wallet.addr}/utxo`).then((res) =>{
        // console.log(res.data);
        const txb = new bitcoin.TransactionBuilder(network);
        // txb.setVersion(1);
        var totalAmount = 0;
        var inputs = 0;
        for(var i=0;i<res.data.length;i++) {
            if(!res.data[i].status.confirmed)
                continue;
            totalAmount += res.data[i].value;
            txb.addInput(res.data[i].txid, res.data[i].vout);
            inputs++;
        }
        var txSize = inputs * 149 + 2 * 34 + 10;
        var fee = txSize * feePerSatushi;
        console.log(amount, totalAmount, inputs, txSize, feePerSatushi, fee);
        txb.addOutput(target, amount);
        txb.addOutput(wallet.addr, totalAmount - amount - fee);
        console.log("signing tx", wallet.pkey);
        for(var j = 0; j < inputs; j++) {
            txb.sign({
                prevOutScriptType: 'p2pkh',
                vin: j,
                keyPair: wallet.pkey
            });
        }
        var signedTx = txb.build().toHex();
        requests.post(`https://blockstream.info/testnet/api/tx`, signedTx)
        .then((res) =>{
            console.log(res.data);
            msg.reply.text("Payment has been sent!\n"+
            `txHash: ${res.data}`);
        }).catch((err) =>{
            console.log("failed to broadcast transaction!", err);
        });
    }).catch((err) =>{

    });
}

function request(dialogId, msg, text) {
    var wallet = loadWallet(dialogId);
    if(!wallet) {
        msg.reply.text("Can't recognize you!\nDid you change your number recently?");
        return;
    }
    var brokenText = text.split(" ");
    var amount = (brokenText.length >1?"?amount=" + brokenText[1]:"");
    msg.reply.text(`bitcoin:${wallet.addr}${amount}`);
    //TODO: qr code
}


const helpMsg = "few simple commands to get you started:\n" +
"help - show this message\n" +
"pay <bitcoin address> <ammount>\n" +
"balance - request your balance";
bot.on(['text'], (msg) => {
    console.log(msg.text, msg.from.id);
    if(msg.text.startsWith("/")) {
        if(msg.text.startsWith("/start")) {
            msg.reply.text("Welcome to Bitcoin Wallet Bot!");
            sleep(500);
            msg.reply.text("We will create a bitcoin wallet for you, so you can start using bitcoin");
            sleep(500);
            msg.reply.text(`your wallet has been created! your address is ${createWallet(msg.from.id)}!`);
            sleep(500);
            msg.reply.text("Now you can use this address to request bitcoins!");
            sleep(500);
            msg.reply.text(helpMsg);
            return;
        }
    } 
    if(msg.text.indexOf("pay") != -1) {
        pay(msg.from.id, msg, msg.text);
    } else if(msg.text.indexOf("balance") != -1) {
        balance(msg.from.id, msg);
    } else if(msg.text.indexOf("request") != -1) {
        request(msg.from.id, msg, msg.text);
    } else if(msg.text.indexOf("help") != -1) {
        msg.reply.text(helpMsg);
    } else {
        console.log(`unknown command: ${msg.text}`);
    }
});

bot.on(['callbackQuery', 'inlineQuery'], (msg) => {
});

bot.start();

setInterval(function(e){
    requests.get(`https://blockstream.info/testnet/api/fee-estimates`).then((res) => {
        if(!res.data["2"]) {
            console.log(`failed to get fee estimation!`, res.data);
            return;
        }
        feePerSatushi = Number(res.data["2"]);
    }).catch((err) =>  {

    });
}, 10000);