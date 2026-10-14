import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
getFirestore,
collection,
addDoc,
query,
orderBy,
onSnapshot
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig }
from "./firebase.js";

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

window.sendMessage = async function(){

    const input =
    document.getElementById("messageInput");

    const text = input.value.trim();

    if(text === "") return;

    try{

        await addDoc(
            collection(db,"messages"),
            {
                text:text,
                time:Date.now()
            }
        );

        input.value = "";

    }catch(error){

        console.log(error);

    }
};

const q = query(
    collection(db,"messages"),
    orderBy("time")
);

onSnapshot(q,(snapshot)=>{

    const messagesDiv =
    document.getElementById("messages");

    messagesDiv.innerHTML = "";

    snapshot.forEach((doc)=>{

        const data = doc.data();

        messagesDiv.innerHTML += `
            <div class="message">
                ${data.text}
            </div>
        `;

    });

    messagesDiv.scrollTop =
    messagesDiv.scrollHeight;

});
