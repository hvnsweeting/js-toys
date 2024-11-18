//https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval
let intervalId;
let to;
let counter;


let number = document.getElementById("number");
let debug = document.getElementById("debug");
const synth = window.speechSynthesis;
let voices = synth.getVoices();
let voiceSelect = document.getElementById("lang");
let voice;

function countUp() {
    to = Number(document.getElementById("to").value);
    document.documentElement.setAttribute("lang", document.getElementById("lang").value);
    counter = 1;
    doCountUp()
}

function countDown() {
    if (!intervalId) {
        intervalId = setInterval(doCountDown, 1500)
    }
    counter = Number(document.getElementById("to").value);
    document.documentElement.setAttribute("lang", document.getElementById("lang").value);
    to = 1

    const selectedOption =
        voiceSelect.selectedOptions[0].getAttribute("data-name");
    for (let i = 0; i < voices.length; i++) {
        if (voices[i].name === selectedOption) {
            voice = voices[i];
        }
    }
}

function populateVoiceList() {

    for (let i = 0; i < voices.length; i++) {
        if (! ["en-US", "vi", "ja"].includes(voices[i].lang)) {
            continue
        }
        const option = document.createElement("option");
        option.textContent = `${voices[i].name} (${voices[i].lang})`;

        if (voices[i].default) {
            option.textContent += " — DEFAULT";
        }

        option.setAttribute("data-lang", voices[i].lang);
        option.setAttribute("data-name", voices[i].name);
        voiceSelect.appendChild(option);
    }
}

populateVoiceList();

function doCountDown() {
    if (counter == to) {
        clearInterval(intervalId);
        intervalId = null;
    }

    utter = new SpeechSynthesisUtterance(`${counter}`);
    utter.voice = voice;
    utter.rate = 0.9; // speed - tốc độ

    number.innerText = `${counter}`
    synth.speak(utter);
    counter--;
}


function sleep (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}


async function doCountUp() {

    for (i=1; i<=to; i++)
    {
        utter = new SpeechSynthesisUtterance(`${i}`);
        utter.voice = voice;
        utter.rate = 0.9 // speed - tốc độ
        number.innerText = `${i}`
        synth.speak(utter)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }


}


document.getElementById("count").addEventListener('click', countUp);
document.getElementById("countDown").addEventListener('click', countDown);
