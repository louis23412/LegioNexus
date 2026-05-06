import fs from 'fs';
import path from 'path';

export class Chatroom {
    #saveFile;
    #messages = [];

    constructor() {
        // this.#saveFile = path.join(stateFolder, 'chatroom.json');
        // this.#load();
    }

    // #load() {
    //     try {
    //         const data = fs.readFileSync(this.#saveFile, 'utf8');
    //         this.#messages = JSON.parse(data);
    //     } 
    //     catch (err) { this.#messages = []; }
    // }

    // #save() {
    //     try { fs.writeFileSync(this.#saveFile, JSON.stringify(this.#messages, null, 2), 'utf8'); } 
    //     catch (err) {}
    // }

    sendMessage(speaker, content) {
        this.#messages.push({
            id: this.#messages.length + 1,
            timestamp: Date.now(),
            speaker,
            content
        });

        // this.#save();

        return this.#messages.length;
    }

    viewMessages() {
        return this.#messages;
    }
}