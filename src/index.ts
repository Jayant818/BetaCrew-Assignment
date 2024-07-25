import * as net from "net";
import * as fs from "fs";
import { HOST, PORT } from "./constants";

interface Packet {
	symbol: string;
	buySellIndicator: string;
	quantity: number;
	price: number;
	sequence: number;
}

const packets: Packet[] = [];
let maxSequence = 0;

function createPayload(callType: number, resendSeq: number = 0): Buffer {
	const buffer = Buffer.alloc(2);
	buffer.writeUInt8(callType, 0);
	buffer.writeUInt8(resendSeq, 1);
	return buffer;
}

function parsePacket(data: Buffer): Packet {
	const symbol = data.slice(0, 4).toString("ascii");
	const buySellIndicator = data.slice(4, 5).toString("ascii");
	const quantity = data.readInt32BE(5);
	const price = data.readInt32BE(9);
	const sequence = data.readInt32BE(13);

	return { symbol, buySellIndicator, quantity, price, sequence };
}

function streamAllPackets(): Promise<void> {
	return new Promise((resolve, reject) => {
		const client = new net.Socket();

		client.connect(PORT, HOST, () => {
			console.log("Connected to server");
			client.write(createPayload(1));
		});

		client.on("data", (data: Buffer) => {
			for (let i = 0; i < data.length; i += 17) {
				const packet = parsePacket(data.slice(i, i + 17));
				packets.push(packet);
				maxSequence = Math.max(maxSequence, packet.sequence);
			}
		});

		client.on("close", () => {
			console.log("Connection closed");
			resolve();
		});

		client.on("error", (err: Error) => {
			console.error("Error:", err);
			reject(err);
		});
	});
}

function resendPacket(sequence: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const client = new net.Socket();

		client.connect(PORT, HOST, () => {
			console.log(`Requesting resend for sequence ${sequence}`);
			client.write(createPayload(2, sequence));
		});

		client.on("data", (data: Buffer) => {
			const packet = parsePacket(data);
			packets.push(packet);
			client.destroy();
		});

		client.on("close", () => {
			console.log(`Resend for sequence ${sequence} complete`);
			resolve();
		});

		client.on("error", (err: Error) => {
			console.error("Error:", err);
			reject(err);
		});
	});
}

async function main() {
	try {
		await streamAllPackets();

		const missingSequences: number[] = [];
		for (let i = 1; i < maxSequence; i++) {
			if (!packets.some((p) => p.sequence === i)) {
				missingSequences.push(i);
			}
		}

		console.log("Missing sequences:", missingSequences);

		for (const seq of missingSequences) {
			await resendPacket(seq);
		}

		packets.sort((a, b) => a.sequence - b.sequence);

		fs.writeFileSync("output.json", JSON.stringify(packets, null, 2));
		console.log("Output written to output.json");
	} catch (error) {
		console.error("An error occurred:", error);
	}
}

main();
