//https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval
let intervalId;
let to;
let counter;


let number = document.getElementById("number");
let debug = document.getElementById("debug");
const synth = window.speechSynthesis;
let voices = synth.getVoices();
// for chrome
synth.addEventListener('voiceschanged', () =>{voices = synth.getVoices()})
let voiceSelect = document.getElementById("lang");
let voice;


function populateVoiceList() {

    document.getElementById("debug").innerText = `${voices.length} voices: ${voices.slice(0,3).map((i) => i.name)}...`

    for (let i = 0; i < voices.length; i++) {
        if (! ["en-us", "vi", "ja"].includes(voices[i].lang.toLowerCase())) {
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

async function countDown() {

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
    for (i=counter; i>=to; i--)
    {
        utter = new SpeechSynthesisUtterance(`${i}`);
        utter.voice = voice;
        utter.rate = 0.9 // speed - tốc độ
        number.innerText = `${i}`
        synth.speak(utter)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}


function sleep (time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}


async function countUp() {
    to = Number(document.getElementById("to").value);
    document.documentElement.setAttribute("lang", document.getElementById("lang").value);
    counter = 1;

    for (i=1; i<=to; i++)
    {
        utter = new SpeechSynthesisUtterance(`${i}`);
        utter.rate = 0.9 // speed - tốc độ
        number.innerText = `${i}`
        synth.speak(utter)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}


document.getElementById("count").addEventListener('click', countUp);
document.getElementById("countDown").addEventListener('click', countDown);
