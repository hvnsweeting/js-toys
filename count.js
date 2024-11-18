//https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval
let intervalId;
let to;
let counter;


let number = document.getElementById("number");

function countUp() {
    to = Number(document.getElementById("to").value);
    counter = 1;
    if (!intervalId) {
        intervalId = setInterval(doCountUp, 1000)
    }
}

function countDown() {
    if (!intervalId) {
        intervalId = setInterval(doCountDown, 1000)
    }
    counter = Number(document.getElementById("to").value);
    to = 1
}

function doCountDown() {
    synth = window.speechSynthesis

    voices = synth.getVoices()
    if (counter == to) {
        clearInterval(intervalId);
        intervalId = null;
    }

    utter = new SpeechSynthesisUtterance(`${counter}`);
    utter.rate = 0.9; // speed - tốc độ

    number.innerText = `${counter}`
    synth.speak(utter);
    counter--;
}


function doCountUp() {
    synth = window.speechSynthesis

    voices = synth.getVoices()
    if (counter == to) {
        clearInterval(intervalId)
        intervalId = null;
    }

    utter = new SpeechSynthesisUtterance(`${counter}`);
    utter.rate = 0.9; // speed - tốc độ

    number.innerText = `${counter}`
    synth.speak(utter);
    counter++;
}

function stop() {
    clearInterval(intervalId);
    intervalId = null;
    counter = 1;
    number.innerText = '_';
}

document.getElementById("count").addEventListener('click', countUp);
document.getElementById("countDown").addEventListener('click', countDown);
document.getElementById("stop").addEventListener('click', stop);
