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

const getVoicebyLang = lang => speechSynthesis
  .getVoices()
  .find(voice => voice.lang.startsWith(lang))

document.getElementById("debug").innerText = `${voices.length} voices: ${voices.slice(0,3).map((i) => i.name)}...`

async function countDown() {

    counter = Number(document.getElementById("to").value);
    to = 1

    const voice = getVoicebyLang(document.getElementById("lang").value);
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
    counter = 1;

    const voice = getVoicebyLang(document.getElementById("lang").value);
    for (i=1; i<=to; i++)
    {
        utter = new SpeechSynthesisUtterance(`${i}`);
        utter.rate = 0.9 // speed - tốc độ
        utter.voice = voice;
        number.innerText = `${i}`
        synth.speak(utter)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}


document.getElementById("count").addEventListener('click', countUp);
document.getElementById("countDown").addEventListener('click', countDown);
